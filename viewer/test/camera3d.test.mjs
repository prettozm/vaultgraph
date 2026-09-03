import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CAMERA,
  MAX_DISTANCE,
  MAX_PITCH,
  MIN_DISTANCE,
  createCamera,
  eyeOf,
  fitToPoints,
  orbit,
  pan,
  project,
  resetView,
  zoom,
} from '../src/lib/camera3d.js';

const VIEWPORT = { width: 800, height: 600 };

test('createCamera applies defaults and clamps its inputs', () => {
  const cam = createCamera();
  assert.equal(cam.yaw, DEFAULT_CAMERA.yaw);
  assert.equal(cam.pitch, DEFAULT_CAMERA.pitch);
  assert.deepEqual(cam.target, { x: 0, y: 0, z: 0 });

  const wild = createCamera({ pitch: 3, distance: 1e9, target: { x: 5, y: 6, z: 7 } });
  assert.equal(wild.pitch, MAX_PITCH);
  assert.equal(wild.distance, MAX_DISTANCE);
  assert.deepEqual(wild.target, { x: 5, y: 6, z: 7 });
});

test('project puts the target at the centre of the viewport', () => {
  for (const cam of [createCamera(), createCamera({ yaw: 1.2, pitch: -0.7, distance: 900 })]) {
    const p = project(cam.target, cam, VIEWPORT);
    assert.ok(Math.abs(p.sx - VIEWPORT.width / 2) < 1e-9);
    assert.ok(Math.abs(p.sy - VIEWPORT.height / 2) < 1e-9);
    assert.ok(Math.abs(p.depth - cam.distance) < 1e-9);
    assert.ok(p.scale > 0);
    assert.equal(p.behind, false);
  }
});

test('project: nearer points get a larger scale, and screen Y points up', () => {
  const cam = createCamera({ yaw: 0, pitch: 0, distance: 1000 });
  const near = project({ x: 0, y: 0, z: 400 }, cam, VIEWPORT);
  const far = project({ x: 0, y: 0, z: -400 }, cam, VIEWPORT);
  assert.ok(near.scale > far.scale);
  assert.ok(near.depth < far.depth);

  const up = project({ x: 0, y: 100, z: 0 }, cam, VIEWPORT);
  assert.ok(up.sy < VIEWPORT.height / 2);
  const right = project({ x: 100, y: 0, z: 0 }, cam, VIEWPORT);
  assert.ok(right.sx > VIEWPORT.width / 2);
});

test('orbit clamps pitch to ±85° and keeps yaw wrapped', () => {
  const cam = createCamera({ pitch: 0 });
  assert.ok(Math.abs(orbit(cam, 0, 10).pitch - MAX_PITCH) < 1e-12);
  assert.ok(Math.abs(orbit(cam, 0, -10).pitch + MAX_PITCH) < 1e-12);
  const spun = orbit(cam, 100, 0);
  assert.ok(spun.yaw >= -Math.PI && spun.yaw < Math.PI);
  // pure: the original is untouched
  assert.equal(cam.pitch, 0);
});

test('zoom clamps distance in both directions', () => {
  const cam = createCamera({ distance: 1000 });
  assert.equal(zoom(cam, 2).distance, 500);
  assert.equal(zoom(cam, 1e6).distance, MIN_DISTANCE);
  assert.equal(zoom(cam, 1e-6).distance, MAX_DISTANCE);
  assert.equal(zoom(cam, 0).distance, 1000); // a bad factor is ignored
  assert.equal(cam.distance, 1000);
});

test('pan moves content with the pointer', () => {
  const cam = createCamera({ yaw: 0, pitch: 0, distance: 1000 });
  const before = project({ x: 0, y: 0, z: 0 }, cam, VIEWPORT);
  const after = project({ x: 0, y: 0, z: 0 }, pan(cam, 50, 30, VIEWPORT), VIEWPORT);
  assert.ok(Math.abs(after.sx - (before.sx + 50)) < 1e-6);
  assert.ok(Math.abs(after.sy - (before.sy + 30)) < 1e-6);
});

test('fitToPoints frames every point inside the viewport', () => {
  const points = [
    { x: -500, y: -400, z: -320 },
    { x: 500, y: 400, z: 320 },
    { x: 120, y: -90, z: 0 },
    { x: -430, y: 380, z: 160 },
  ];
  const cam = fitToPoints(createCamera({ distance: 100 }), points, VIEWPORT, { margin: 40 });
  for (const p of points) {
    const s = project(p, cam, VIEWPORT);
    assert.equal(s.behind, false, 'no point ends up behind the camera');
    assert.ok(s.sx >= 0 && s.sx <= VIEWPORT.width, `sx ${s.sx} inside viewport`);
    assert.ok(s.sy >= 0 && s.sy <= VIEWPORT.height, `sy ${s.sy} inside viewport`);
  }
  // the target is the centre of the cloud
  assert.ok(Math.abs(cam.target.x - 0) < 1e-9);
  assert.ok(cam.distance > 100);
});

test('fitToPoints on an empty cloud falls back to a usable camera', () => {
  const cam = fitToPoints(createCamera(), [], VIEWPORT);
  assert.deepEqual(cam.target, { x: 0, y: 0, z: 0 });
  assert.ok(cam.distance >= MIN_DISTANCE);
});

test('resetView restores the default tilt but keeps the framing', () => {
  const cam = createCamera({ yaw: 2.1, pitch: -1.2, distance: 640, target: { x: 10, y: 20, z: 30 } });
  const reset = resetView(cam);
  assert.equal(reset.yaw, DEFAULT_CAMERA.yaw);
  assert.equal(reset.pitch, DEFAULT_CAMERA.pitch);
  assert.equal(reset.distance, 640);
  assert.deepEqual(reset.target, { x: 10, y: 20, z: 30 });
  assert.notEqual(reset.pitch, 0, 'default view is tilted so layers read as planes');
});

test('eyeOf sits at `distance` from the target', () => {
  const cam = createCamera({ distance: 777, target: { x: 3, y: 4, z: 5 } });
  const eye = eyeOf(cam);
  const d = Math.hypot(eye.x - 3, eye.y - 4, eye.z - 5);
  assert.ok(Math.abs(d - 777) < 1e-9);
});
