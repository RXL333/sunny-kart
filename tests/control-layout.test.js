import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_ACTIONS, CONTROL_LAYOUT_STORAGE_KEY, LEGACY_CONTROL_LAYOUT_STORAGE_KEY, layoutOrientation, validateControlLayouts, readControlLayouts, saveControlLayouts, resolveControlPositions, normalizeControlPositions, overlappingControls } from '../src/control-layout.js';

const positions = (x = .5, y = .5) => Object.fromEntries(CONTROL_ACTIONS.map((action, i) => [action, { x: x + i / 30, y }]));
const makeStorage = () => {
  const values = new Map();return { values, getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};

test('custom layouts preserve independent portrait and landscape positions after reload', () => {
  const storage = makeStorage(), landscape = positions(.1, .8), portrait = positions(.2, .7);
  assert.equal(saveControlLayouts(storage, { landscape, portrait }), true);
  assert.deepEqual(readControlLayouts(storage), { version: 2, landscape, portrait });
  assert.equal(layoutOrientation(844, 390), 'landscape');assert.equal(layoutOrientation(390, 844), 'portrait');
  assert.equal(layoutOrientation(500, 500), 'portrait');
  assert.equal(saveControlLayouts(storage, { landscape: null, portrait }), true);
  assert.deepEqual(readControlLayouts(storage), { version: 2, landscape: null, portrait });
});

test('corrupt or incomplete layouts fall back safely without injecting action names', () => {
  for (const text of ['{broken', '[]', 'null', 'true', '42', '"layout"']) assert.deepEqual(readControlLayouts({ getItem: () => text }), { version: 2, landscape: null, portrait: null });
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
  assert.deepEqual(readControlLayouts(blocked), { version: 2, landscape: null, portrait: null });
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
  resolved.positions.left.x += 25;resolved.positions.left.y -= 170;
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

test('legacy six-button layouts migrate without changing either orientation or overwriting v1 storage', () => {
  const actions=['left','right','drift','nitro','brake','throttle'];
  const viewports={landscape:{width:844,height:390,size:64},portrait:{width:390,height:844,size:64}};
  const legacy={version:1};
  for(const [orientation,viewport] of Object.entries(viewports)) {
    const resolved=resolveControlPositions(null,viewport);
    legacy[orientation]=Object.fromEntries(actions.map(action=>[action,{x:resolved.positions[action].x/viewport.width,y:resolved.positions[action].y/viewport.height}]));
  }
  const storage=makeStorage(),original=JSON.stringify(legacy);storage.values.set(LEGACY_CONTROL_LAYOUT_STORAGE_KEY,original);
  const migrated=readControlLayouts(storage);
  assert.deepEqual(migrated,{...legacy,version:2});
  for(const [orientation,viewport] of Object.entries(viewports)) {
    const {positions,geometry}=resolveControlPositions(migrated[orientation],viewport);
    for(const action of actions) {
      assert.equal(positions[action].x,legacy[orientation][action].x*viewport.width);
      assert.equal(positions[action].y,legacy[orientation][action].y*viewport.height);
    }
    assert.equal(overlappingControls(positions,geometry.size,geometry.itemSize),false);
  }
  assert.equal(storage.values.get(LEGACY_CONTROL_LAYOUT_STORAGE_KEY),original);
  assert.equal(storage.values.has(CONTROL_LAYOUT_STORAGE_KEY),false);
  assert.equal(saveControlLayouts(storage,migrated),true);
  assert.deepEqual(readControlLayouts(storage),migrated);
  saveControlLayouts(storage,{version:2,landscape:null,portrait:null});
  assert.deepEqual(readControlLayouts(storage),{version:2,landscape:null,portrait:null});
  assert.equal(storage.values.get(LEGACY_CONTROL_LAYOUT_STORAGE_KEY),original,'explicit v2 reset does not delete rollback data');
});

test('item placement finds a vacant space in a customized six-button layout while keeping driving buttons still', () => {
  const viewport={width:568,height:320,size:64,safe:{left:24,right:24,top:12,bottom:20}};
  const {positions:defaults,geometry}=resolveControlPositions(null,viewport);
  // The old player put a driving action exactly where the new item preset goes.
  const original={...defaults,left:{...defaults.useItem}};delete original.useItem;
  const layout=Object.fromEntries(Object.entries(original).map(([action,point])=>[action,{x:point.x/viewport.width,y:point.y/viewport.height}]));
  const resolved=resolveControlPositions(layout,viewport);
  for(const action of Object.keys(layout)) assert.deepEqual(resolved.positions[action],original[action]);
  assert.equal(overlappingControls(resolved.positions,geometry.size,resolved.geometry.itemSize),false);
  assert.notDeepEqual(resolved.positions.useItem,defaults.useItem);
});

test('a crowded legacy layout only shrinks the new item control, and saving/reloading retains that safe placement', () => {
  const viewport={width:568,height:320,size:64,safe:{left:24,right:24,top:12,bottom:20}};
  const layout={left:{x:.31579850677361476,y:.6754376890952699},right:{x:.839833571703475,y:.7057423390506301},drift:{x:.7048528559906014,y:.6934066553250886},nitro:{x:.5270648821762067,y:.7915477961127181},brake:{x:.48228971476824034,y:.5051310150302015},throttle:{x:.1163512555272384,y:.6431825056264643}};
  const first=resolveControlPositions(layout,viewport);
  assert.equal(first.geometry.size,64);assert.equal(first.geometry.itemSize,44);
  assert.equal(overlappingControls(first.positions,64,44),false);
  for(const [action,point] of Object.entries(layout)) assert.deepEqual(first.positions[action],{x:point.x*568,y:point.y*320});
  const storage=makeStorage();saveControlLayouts(storage,{landscape:normalizeControlPositions(first.positions,viewport)});
  const second=resolveControlPositions(readControlLayouts(storage).landscape,viewport);
  assert.deepEqual(second.positions,first.positions);assert.equal(second.geometry.itemSize,44);
  assert.equal(overlappingControls(second.positions,64,44),false);
});

test('overlapping actions are detected before a layout can be saved from the editor', () => {
  const { positions: original, geometry } = resolveControlPositions(null, { width: 844, height: 390 });
  assert.equal(overlappingControls(original, geometry.size), false);
  original.nitro = { ...original.left };
  assert.equal(overlappingControls(original, geometry.size), true);
});
