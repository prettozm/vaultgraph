import test from 'node:test';
import assert from 'node:assert/strict';
import {
  colorFor,
  coolBlend,
  hslToRgb,
  isTentative,
  shapeForType,
  STAR_WHITE,
  starTint,
  statusColor,
  statusKind,
  statusTint,
} from '../src/lib/colors.js';

test('statusColor is deterministic and theme-aware', () => {
  assert.equal(statusColor('candidate'), statusColor('candidate'));
  assert.notEqual(statusColor('candidate'), statusColor('confirmed'));
  assert.notEqual(statusColor('candidate'), statusColor('candidate', { dark: true }));
  assert.match(statusColor('candidate', { alpha: 0.5 }), /\/ 0\.5\)$/);
  // An unknown vocabulary still gets a stable colour rather than a crash (§26).
  assert.equal(statusColor('brand-new-state'), statusColor('brand-new-state'));
  assert.equal(statusKind('brand-new-state'), null);
  assert.equal(statusKind('CANDIDATE'), 'candidate');
});

test('candidate and unresolved are the states the UI must single out', () => {
  assert.equal(isTentative('candidate'), true);
  assert.equal(isTentative('Unresolved'), true);
  assert.equal(isTentative('explicit'), false);
  assert.equal(isTentative(undefined), false);
});

test('shape carries the type so colour is never the only channel (§19)', () => {
  assert.equal(shapeForType('source'), 'square');
  assert.equal(shapeForType('decision'), 'diamond');
  assert.equal(shapeForType('hypothese'), 'triangle');
  assert.equal(shapeForType('concept'), 'circle');
  assert.equal(shapeForType(null), 'circle');
  assert.equal(colorFor('concept'), colorFor('concept'));
});

// --------------------------------------------------------------------------
// v0.3.1 star tints
// --------------------------------------------------------------------------

const TYPES = ['concept', 'besoin', 'cas_usage', 'decision', 'fonctionnalite', 'hypothese', 'source', 'contexte'];

function parseRgb(css) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  assert.ok(m, `parsable rgb: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** CIE76 ΔE over sRGB→Lab; good enough to assert "these are not the same colour". */
function deltaE(a, b) {
  const lab = (rgb) => {
    const lin = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const [r, g, bl] = lin;
    const x = (r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + bl * 0.0722;
    const z = (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

test('starTint is deterministic and separates the two themes', () => {
  for (const t of TYPES) {
    assert.equal(starTint(t, { dark: true }), starTint(t, { dark: true }), 'stable (night)');
    assert.equal(starTint(t), starTint(t), 'stable (day)');
    assert.notEqual(starTint(t), starTint(t, { dark: true }), 'day is not night');
  }
  assert.notEqual(starTint('concept', { dark: true }), starTint('besoin', { dark: true }));
  assert.notEqual(starTint('concept'), starTint('besoin'));
});

// --------------------------------------------------------------------------
// v0.3.2 — the day theme is the same language with the luminance inverted
// --------------------------------------------------------------------------

test('day tints read as one family too: deep, legible, navy-leaning', () => {
  for (const t of TYPES) {
    const [r, g, b] = parseRgb(starTint(t));
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // A dark star on a pale sky: the mirror of the night test's `max >= 170`.
    assert.ok(max <= 165, `${t} is a dark star, not a pale chip (max channel ${max})`);
    assert.ok(max - min <= 120, `${t} keeps its chroma in check (spread ${max - min})`);
    assert.ok(b >= min, `${t} keeps a navy bias (b ${b}, min ${min})`);
  }
});

test('day tints stay mutually distinguishable (pairwise ΔE)', () => {
  let worst = Infinity;
  let worstPair = null;
  for (let i = 0; i < TYPES.length; i += 1) {
    for (let j = i + 1; j < TYPES.length; j += 1) {
      const d = deltaE(parseRgb(starTint(TYPES[i])), parseRgb(starTint(TYPES[j])));
      if (d < worst) {
        worst = d;
        worstPair = [TYPES[i], TYPES[j]];
      }
    }
  }
  assert.ok(worst >= 8, `closest day pair ${worstPair?.join(' / ')} is ΔE ${worst.toFixed(1)} apart`);
});

test('the day depth cue sinks a tint toward the navy without losing it', () => {
  const chroma = (c) => Math.max(...c) - Math.min(...c);
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const t of TYPES) {
    const near = parseRgb(starTint(t, { cool: 0 }));
    const far = parseRgb(starTint(t, { cool: 1 }));
    assert.ok(chroma(far) <= chroma(near), `${t} loses chroma with distance`);
    assert.ok(luma(far) <= luma(near) + 1, `${t} deepens with distance instead of glowing`);
  }
});

test('a day star reads as ink against the pale sky (#dfe7f2 … #f7f9fd)', () => {
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const skyFloor = luma([223, 231, 242]); // --canvas-bg-bottom
  for (const t of TYPES) {
    assert.ok(luma(parseRgb(starTint(t))) < skyFloor - 40, `${t} reads as ink against the day sky`);
  }
});

test('night tints read as one luminous family: pale, bright, cool', () => {
  for (const t of TYPES) {
    const [r, g, b] = parseRgb(starTint(t, { dark: true }));
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    assert.ok(max >= 170, `${t} is a bright star, not a dark dot (max channel ${max})`);
    // Blended 55 % toward #dfe8ff ⇒ the chroma is capped: a star, not a chip.
    assert.ok(max - min <= 120, `${t} keeps its chroma in check (spread ${max - min})`);
  }
});

test('night tints stay mutually distinguishable (pairwise ΔE)', () => {
  let worst = Infinity;
  let worstPair = null;
  for (let i = 0; i < TYPES.length; i += 1) {
    for (let j = i + 1; j < TYPES.length; j += 1) {
      const d = deltaE(parseRgb(starTint(TYPES[i], { dark: true })), parseRgb(starTint(TYPES[j], { dark: true })));
      if (d < worst) {
        worst = d;
        worstPair = [TYPES[i], TYPES[j]];
      }
    }
  }
  // Pastel is fine; indistinguishable is not — the type channel has to survive
  // the blend toward white or shape would be carrying it alone.
  assert.ok(worst >= 8, `closest pair ${worstPair?.join(' / ')} is ΔE ${worst.toFixed(1)} apart`);
});

test('the cool depth cue pushes a tint toward white without losing its identity', () => {
  for (const t of TYPES) {
    const near = parseRgb(starTint(t, { dark: true, cool: 0 }));
    const far = parseRgb(starTint(t, { dark: true, cool: 1 }));
    const chroma = (c) => Math.max(...c) - Math.min(...c);
    assert.ok(chroma(far) <= chroma(near), `${t} loses chroma with distance`);
    assert.ok(far[2] >= far[0] - 40, `${t} cools toward blue-white rather than warming`);
  }
});

test('statusTint mirrors starTint for the epistemic projection', () => {
  assert.equal(statusTint('candidate'), starTint('candidate', { hue: 38 }), 'day follows the star tints too');
  assert.ok(deltaE(parseRgb(statusTint('candidate')), parseRgb(statusTint('confirmed'))) >= 8, 'day statuses stay apart');
  const a = statusTint('candidate', { dark: true });
  const b = statusTint('confirmed', { dark: true });
  assert.notEqual(a, b);
  assert.ok(deltaE(parseRgb(a), parseRgb(b)) >= 8, 'statuses stay apart on the night ground');
  assert.equal(a, statusTint('CANDIDATE', { dark: true }), 'case-insensitive, like statusKind');
});

test('hslToRgb and coolBlend are sane', () => {
  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
  assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0]);
  assert.deepEqual(hslToRgb(240, 1, 0.5), [0, 0, 255]);
  assert.deepEqual(coolBlend([0, 0, 0], 0), [0, 0, 0]);
  assert.deepEqual(coolBlend([0, 0, 0], 1), [...STAR_WHITE]);
});
