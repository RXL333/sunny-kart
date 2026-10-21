import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_ACTIONS, CONTROL_LAYOUT_STORAGE_KEY, layoutOrientation, validateControlLayouts, readControlLayouts, saveControlLayouts, resolveControlPositions, normalizeControlPositions, overlappingControls } from '../src/control-layout.js';

const positions = (x = .5, y = .5) => Object.fromEntries(CONTROL_ACTIONS.map((action, i) => [action, { x: x + i / 30, y }]));
const makeStorage = () => {
  const values = new Map();return { values, getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};

test('custom layouts preserve independent portrait and landscape positions after reload', () => {
  const storage = makeStorage(), landscape = positions(.1, .8), portrait = positions(.2, .7);
  assert.equal(saveControlLayouts(storage, { landscape, portrait }), true);
  assert.deepEqual(readControlLayouts(storage), { version: 1, landscape, portrait });
  assert.equal(layoutOrientation(844, 390), 'landscape');assert.equal(layoutOrientation(390, 844), 'portrait');
  assert.equal(layoutOrientation(500, 500), 'portrait');
  assert.equal(saveControlLayouts(storage, { landscape: null, portrait }), true);
  assert.deepEqual(readControlLayouts(storage), { version: 1, landscape: null, portrait });
});

test('corrupt or incomplete layouts fall back safely without injecting action names', () => {
  for (const text of ['{broken', '[]', 'null', 'true', '42', '"layout"']) assert.deepEqual(readControlLayouts({ getItem: () => text }), { version: 1, landscape: null, portrait: null });
  const invalid = positions();invalid.left.x = '0.2';
  const partial = { left: { x: .1, y: .2 } };
  assert.equal(validateControlLayouts({ landscape: invalid }).landscape, null);
  assert.equal(validateControlLayouts({ portrait: partial }).portrait, null);
  invalid.left.x = Infinity;assert.equal(validateControlLayouts({ landscape: invalid }).landscape, null);
  const source = positions(-2, 9);source.unknown = { x: .2, y: .3 };
  const result = validateControlLayouts({ landscape: source, unknown: 'ignored' });
  assert.equal(result.landscape.left.x, 0);assert.equal(result.landscape.left.y, 1);
  assert.deepEqual(Object.keys(result.landscape), CONTROL_ACTIONS);
  assert.equal(validateControlLayouts(Object.create({ landscape: positions() })).landscape, null);
  assert.equal({}.polluted, undefined);
});

test('storage failures report failure and never prevent an in-memory layout from being used', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.equal(saveControlLayouts(blocked, { landscape: positions() }), false);
  assert.equal(saveControlLayouts(undefined, { portrait: positions() }), false);
  assert.deepEqual(readControlLayouts(blocked), { version: 1, landscape: null, portrait: null });
  const storage = makeStorage();saveControlLayouts(storage, { landscape: positions() });
  assert.ok(storage.values.has(CONTROL_LAYOUT_STORAGE_KEY));
});

test('both presets fit safe areas without overlapping on short landscape and narrow portrait screens', () => {
  for (const [width, height] of [[844, 390], [667, 375], [568, 320], [320, 568], [390, 844], [1024, 768]]) {
    for (const handedness of ['standard', 'left-handed']) for (const size of [56, 64, 84]) for (const bottom of [8,18,48]) {
      const viewport = { width, height, size, safe: { left: 24, right: 24, top: 12, bottom: 20 } };
      const { positions, geometry } = resolveControlPositions(null, viewport, { handedness,bottom });
      assert.equal(overlappingControls(positions, geometry.size), false, `${width}x${height}, ${handedness}, ${size}`);
      for (const point of Object.values(positions)) {
        assert.ok(point.x - geometry.size / 2 >= 24 - .001);assert.ok(point.x + geometry.size / 2 <= width - 24 + .001);
        assert.ok(point.y - geometry.size / 2 >= geometry.minY - geometry.size / 2 - .001);assert.ok(point.y + geometry.size / 2 <= height - 20 + .001);
      }
      assert.ok(positions.left.x < positions.right.x, 'left-handed mode changes cluster location without reversing directions');
    }
  }
});

test('saved normalized positions scale, clamp fully inside safe bounds and retain movement across reload', () => {
  const first = { width: 844, height: 390, size: 64, safe: { left: 44, right: 16, top: 12, bottom: 20 } };
  const resolved = resolveControlPositions(null, first);
  resolved.positions.left.x += 25;resolved.positions.left.y -= 70;
  const normalized = normalizeControlPositions(resolved.positions, first), storage = makeStorage();
  saveControlLayouts(storage, { landscape: normalized });
  const reloaded = resolveControlPositions(readControlLayouts(storage).landscape, first);
  assert.deepEqual(reloaded.positions, resolved.positions);
  const edge = positions();edge.left = { x: 0, y: 0 };edge.right = { x: 1, y: 1 };
  for (const size of [56, 84]) {
    const { positions, geometry: g } = resolveControlPositions(edge, { width: 667, height: 375, size, safe: { left: 44, right: 20, top: 10, bottom: 24 } });
    assert.equal(positions.left.x, g.minX);assert.equal(positions.left.y, g.minY);
    assert.equal(positions.right.x, g.maxX);assert.equal(positions.right.y, g.maxY);
  }
});

test('overlapping actions are detected before a layout can be saved from the editor', () => {
  const { positions: original, geometry } = resolveControlPositions(null, { width: 844, height: 390 });
  assert.equal(overlappingControls(original, geometry.size), false);
  original.nitro = { ...original.left };
  assert.equal(overlappingControls(original, geometry.size), true);
});
