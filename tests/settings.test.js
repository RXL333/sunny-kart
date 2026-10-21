import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, validateSettings, readSettings, saveSettings } from '../src/settings.js';

test('settings accept only known typed values and preserve hardware-specific defaults', () => {
  const result = validateSettings({
    controlLayout: 'left-handed', steeringSensitivity: .55, buttonSize: 76, buttonOpacity: .6,
    controlBottom: 26, autoThrottle: false, graphics: 'smooth', soundVolume: .3, injected: 'ignored',
  }, { autoThrottle: true });
  assert.deepEqual(result, { controlLayout: 'left-handed', steeringSensitivity: .55, buttonSize: 76, buttonOpacity: .6, controlBottom: 26, autoThrottle: false, graphics: 'smooth', soundVolume: .3 });
  assert.equal(validateSettings({}, { autoThrottle: true }).autoThrottle, true);
  assert.equal(validateSettings({}, { autoThrottle: false }).autoThrottle, false);
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
});

test('numeric settings clamp safely while invalid strings, booleans, infinities and enums fall back', () => {
  const clamped = validateSettings({ steeringSensitivity: -10, buttonSize: 1000, buttonOpacity: 0, controlBottom: 1000, soundVolume: -2 });
  assert.equal(clamped.steeringSensitivity, .35);assert.equal(clamped.buttonSize, 84);
  assert.equal(clamped.buttonOpacity, .35);assert.equal(clamped.controlBottom, 48);assert.equal(clamped.soundVolume, 0);
  const invalid = validateSettings({ controlLayout: '__proto__', steeringSensitivity: '0.8', buttonSize: NaN, buttonOpacity: Infinity, controlBottom: true, autoThrottle: 'false', graphics: 'ultra', soundVolume: null });
  assert.deepEqual(invalid, DEFAULT_SETTINGS);
  assert.equal(validateSettings({ buttonSize: 63.8, controlBottom: 17.9 }).buttonSize, 64);
  assert.equal(validateSettings({ buttonSize: 63.8, controlBottom: 17.9 }).controlBottom, 18);
});

test('corrupted, primitive, unavailable and prototype-bearing storage cannot inject settings', () => {
  for (const text of ['{broken', 'null', 'false', '42', '"text"', '[]']) {
    assert.deepEqual(readSettings({ getItem: () => text }), DEFAULT_SETTINGS);
  }
  const storage = { getItem: () => '{"__proto__":{"polluted":true},"graphics":"smooth","buttonSize":999}' };
  assert.deepEqual(readSettings(storage), { ...DEFAULT_SETTINGS, graphics: 'smooth', buttonSize: 84 });
  assert.equal({}.polluted, undefined);
  assert.deepEqual(readSettings({ getItem() { throw new Error('blocked'); } }, { autoThrottle: true }), { ...DEFAULT_SETTINGS, autoThrottle: true });
  assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS);
});

test('saved settings round-trip with canonical keys and quota failures are harmless', () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.equal(saveSettings(storage, { ...DEFAULT_SETTINGS, controlLayout: 'left-handed', soundVolume: .25, buttonSize: 80, unknown: 'drop' }), true);
  assert.ok(data.has(SETTINGS_STORAGE_KEY));
  assert.deepEqual(readSettings(storage), { ...DEFAULT_SETTINGS, controlLayout: 'left-handed', soundVolume: .25, buttonSize: 80 });
  assert.equal(Object.hasOwn(JSON.parse(data.get(SETTINGS_STORAGE_KEY)), 'unknown'), false);
  assert.equal(saveSettings({ setItem() { throw new Error('quota'); } }, DEFAULT_SETTINGS), false);
  assert.equal(saveSettings(undefined, DEFAULT_SETTINGS), false);
});
