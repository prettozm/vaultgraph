// Orbit camera maths for the 3D view. Pure functions, no DOM, no dependency.
//
// Right-handed world, Y up **on screen**: the renderer feeds the 2D layout as
// (x, -y) so the picture keeps the same orientation as the 2D view, and the
// projection Z (scaled) as the third axis.
//
// Every operation returns a NEW camera object; nothing is mutated in place.

export const MIN_DISTANCE = 60;
export const MAX_DISTANCE = 40000;
export const MAX_PITCH = (85 * Math.PI) / 180;
const NEAR = 1;

export const DEFAULT_CAMERA = Object.freeze({
  yaw: -0.42,          // slightly off-axis so layer planes read as planes…
  pitch: 0.26,         // …and slightly from above (~15°): shelves stay distinct
  distance: 1800,
  target: Object.freeze({ x: 0, y: 0, z: 0 }),
  fov: Math.PI / 4,
});

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function num(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** Wrap an angle into [-π, π). */
function wrapAngle(a) {
  if (a >= -Math.PI && a < Math.PI) return a;
  const twoPi = Math.PI * 2;
  let x = (a + Math.PI) % twoPi;
  if (x < 0) x += twoPi;
  return x - Math.PI;
}

/** @returns {{yaw:number,pitch:number,distance:number,target:{x,y,z},fov:number}} */
export function createCamera(overrides = {}) {
  const t = overrides.target ?? DEFAULT_CAMERA.target;
  return {
    yaw: wrapAngle(num(overrides.yaw, DEFAULT_CAMERA.yaw)),
    pitch: clamp(num(overrides.pitch, DEFAULT_CAMERA.pitch), -MAX_PITCH, MAX_PITCH),
    distance: clamp(num(overrides.distance, DEFAULT_CAMERA.distance), MIN_DISTANCE, MAX_DISTANCE),
    target: {
      x: num(t?.x, 0),
      y: num(t?.y, 0),
      z: num(t?.z, 0),
    },
    fov: clamp(num(overrides.fov, DEFAULT_CAMERA.fov), 0.15, 2.6),
  };
}

/** Orthonormal camera basis: `dir` (target → eye), `right`, `up`, `forward`. */
export function basisOf(cam) {
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const dir = { x: cp * sy, y: sp, z: cp * cy };
  return {
    dir,
    forward: { x: -dir.x, y: -dir.y, z: -dir.z },
    right: { x: cy, y: 0, z: -sy },
    up: { x: -sp * sy, y: cp, z: -sp * cy },
  };
}

/** World position of the eye. */
export function eyeOf(cam) {
  const { dir } = basisOf(cam);
  return {
    x: cam.target.x + dir.x * cam.distance,
    y: cam.target.y + dir.y * cam.distance,
    z: cam.target.z + dir.z * cam.distance,
  };
}

function focalOf(cam, viewport) {
  const height = Math.max(num(viewport?.height, 1), 1);
  return height / 2 / Math.tan(cam.fov / 2);
}

/** Orbit by radians. Pitch is clamped to ±85° so the scene never flips. */
export function orbit(cam, dYaw = 0, dPitch = 0) {
  return {
    ...cam,
    target: { ...cam.target },
    yaw: wrapAngle(cam.yaw + num(dYaw, 0)),
    pitch: clamp(cam.pitch + num(dPitch, 0), -MAX_PITCH, MAX_PITCH),
  };
}

/** factor > 1 moves closer (zoom in); distance stays inside its bounds. */
export function zoom(cam, factor = 1) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return {
    ...cam,
    target: { ...cam.target },
    distance: clamp(cam.distance / f, MIN_DISTANCE, MAX_DISTANCE),
  };
}

/**
 * Drag the scene by (dx, dy) screen pixels: the target slides in the camera's
 * screen plane so content follows the pointer.
 */
export function pan(cam, dx = 0, dy = 0, viewport = { width: 1, height: 1 }) {
  const { right, up } = basisOf(cam);
  const k = cam.distance / focalOf(cam, viewport);
  const sx = num(dx, 0) * k;
  const sy = num(dy, 0) * k;
  return {
    ...cam,
    target: {
      x: cam.target.x - right.x * sx + up.x * sy,
      y: cam.target.y - right.y * sx + up.y * sy,
      z: cam.target.z - right.z * sx + up.z * sy,
    },
  };
}

/**
 * Perspective projection.
 * @returns {{sx:number, sy:number, depth:number, scale:number, behind:boolean}}
 *   `depth` is the distance along the view axis (larger = further away);
 *   `scale` (> 0) is the pixels-per-world-unit factor used for depth cueing.
 */
export function project(point, cam, viewport) {
  const width = Math.max(num(viewport?.width, 1), 1);
  const height = Math.max(num(viewport?.height, 1), 1);
  const eye = eyeOf(cam);
  const { right, up, forward } = basisOf(cam);
  const vx = num(point?.x, 0) - eye.x;
  const vy = num(point?.y, 0) - eye.y;
  const vz = num(point?.z, 0) - eye.z;

  const camX = vx * right.x + vy * right.y + vz * right.z;
  const camY = vx * up.x + vy * up.y + vz * up.z;
  const depth = vx * forward.x + vy * forward.y + vz * forward.z;

  const focal = focalOf(cam, { height });
  const scale = focal / Math.max(depth, NEAR);
  return {
    sx: width / 2 + camX * scale,
    sy: height / 2 - camY * scale,
    depth,
    scale,
    behind: depth <= NEAR,
  };
}

/**
 * Frame every point: the target moves to the cloud's centre and the distance
 * grows until all points project inside the viewport, minus `margin` pixels.
 */
export function fitToPoints(cam, points, viewport, { margin = 64 } = {}) {
  const list = Array.isArray(points) ? points.filter((p) => p && Number.isFinite(p.x)) : [];
  const width = Math.max(num(viewport?.width, 1), 1);
  const height = Math.max(num(viewport?.height, 1), 1);
  if (!list.length) {
    return createCamera({ ...cam, target: { x: 0, y: 0, z: 0 }, distance: DEFAULT_CAMERA.distance });
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of list) {
    const px = num(p.x, 0);
    const py = num(p.y, 0);
    const pz = num(p.z, 0);
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (pz < minZ) minZ = pz;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    if (pz > maxZ) maxZ = pz;
  }
  const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };

  const { right, up, forward } = basisOf(cam);
  const focal = focalOf(cam, { height });
  const limX = Math.max(width / 2 - margin, 8);
  const limY = Math.max(height / 2 - margin, 8);

  let distance = MIN_DISTANCE;
  for (const p of list) {
    const dx = num(p.x, 0) - target.x;
    const dy = num(p.y, 0) - target.y;
    const dz = num(p.z, 0) - target.z;
    const a = dx * right.x + dy * right.y + dz * right.z;
    const b = dx * up.x + dy * up.y + dz * up.z;
    const c = dx * forward.x + dy * forward.y + dz * forward.z;
    // |a| * focal / (c + d) <= limX  →  d >= |a| * focal / limX - c
    distance = Math.max(
      distance,
      (Math.abs(a) * focal) / limX - c,
      (Math.abs(b) * focal) / limY - c,
      NEAR * 2 - c
    );
  }

  return {
    ...cam,
    target,
    distance: clamp(distance * 1.02, MIN_DISTANCE, MAX_DISTANCE),
  };
}

/** Back to the default (slightly tilted) orientation; framing is preserved. */
export function resetView(cam = DEFAULT_CAMERA) {
  return {
    ...createCamera(cam),
    yaw: DEFAULT_CAMERA.yaw,
    pitch: DEFAULT_CAMERA.pitch,
    fov: DEFAULT_CAMERA.fov,
  };
}
