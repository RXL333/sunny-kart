import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYBOARD_ACTIONS, DEFAULT_KEY_BINDINGS, KEY_BINDINGS_STORAGE_KEY,
  isBindableCode, keyLabel, validateKeyBindings, readKeyBindings, saveKeyBindings,
  assignKeyBinding, isActionPressed, actionForKey,
} from '../src/keyboard-bindings.js';

const defaults = () => validateKeyBindings(DEFAULT_KEY_BINDINGS);

test('default keyboard bindings cover every action and preserve the alternative driving keys', () => {
  assert.equal(KEYBOARD_ACTIONS.length, 9);
  assert.deepEqual(defaults(), DEFAULT_KEY_BINDINGS);
  assert.equal(Object.isFrozen(DEFAULT_KEY_BINDINGS), true);
  for (const { id } of KEYBOARD_ACTIONS) {
    assert.equal(Object.isFrozen(DEFAULT_KEY_BINDINGS[id]), true);
    for (const code of DEFAULT_KEY_BINDINGS[id]) {
      assert.equal(isActionPressed(new Set([code]), DEFAULT_KEY_BINDINGS, id), true);
      assert.equal(actionForKey(DEFAULT_KEY_BINDINGS, code), id);
    }
  }
  assert.equal(isActionPressed(new Set(['KeyW']), DEFAULT_KEY_BINDINGS, 'brake'), false);
  assert.equal(actionForKey(DEFAULT_KEY_BINDINGS, 'KeyZ'), undefined);
});

test('rebinding replaces the selected slot immediately, keeps alternatives and never mutates the original', () => {
  const initial = defaults();
  const { bindings, error } = assignKeyBinding(initial, 'throttle', 0, 'KeyE');
  assert.equal(error, null);
  assert.deepEqual(bindings.throttle, ['KeyE', 'ArrowUp']);
  assert.deepEqual(initial, DEFAULT_KEY_BINDINGS);
  assert.equal(isActionPressed(new Set(['KeyE']), bindings, 'throttle'), true);
  assert.equal(isActionPressed(new Set(['KeyW']), bindings, 'throttle'), false);
  assert.equal(isActionPressed(new Set(['ArrowUp']), bindings, 'throttle'), true);
  assert.equal(actionForKey(bindings, 'KeyE'), 'throttle');
  assert.equal(actionForKey(bindings, 'KeyW'), undefined);
});

test('occupied and duplicate keys are rejected with the conflicting action name and all bindings retained', () => {
  for (const [action, slot, code, conflict] of [
    ['throttle', 0, 'KeyS', '刹车'],
    ['throttle', 0, 'ArrowUp', '加速'],
    ['left', 1, 'KeyD', '向右转向'],
  ]) {
    const original = defaults(), result = assignKeyBinding(original, action, slot, code);
    assert.match(result.error, new RegExp(conflict));
    assert.deepEqual(result.bindings, original);
  }
  assert.equal(assignKeyBinding(DEFAULT_KEY_BINDINGS, 'throttle', 0, 'KeyW').error, null);
});

test('a secondary binding can be cleared and reused while primary bindings remain mandatory', () => {
  const cleared = assignKeyBinding(DEFAULT_KEY_BINDINGS, 'nitro', 1, null);
  assert.equal(cleared.error, null);
  assert.deepEqual(cleared.bindings.nitro, ['Space']);
  const reuse = assignKeyBinding(cleared.bindings, 'brake', 0, 'KeyN');
  assert.equal(reuse.error, null);
  assert.equal(actionForKey(reuse.bindings, 'KeyN'), 'brake');
  assert.match(assignKeyBinding(reuse.bindings, 'brake', 0, null).error, /主按键/);
  const extra = assignKeyBinding(reuse.bindings, 'pause', 1, 'KeyP');
  assert.deepEqual(extra.bindings.pause, ['Escape', 'KeyP']);
});

test('browser and system controls cannot become driving keys; labels use the same physical codes as input', () => {
  for (const code of ['Tab', 'ControlLeft', 'ControlRight', 'AltLeft', 'MetaLeft', 'F1', 'F12', 'Backspace', 'Delete', '', null, 42]) {
    assert.equal(isBindableCode(code), false);
    assert.ok(assignKeyBinding(DEFAULT_KEY_BINDINGS, 'throttle', 0, code).error);
  }
  for (const code of ['KeyZ', 'Digit7', 'ArrowLeft', 'Space', 'ShiftRight', 'Escape', 'Enter', 'Numpad4', 'NumpadAdd', 'BracketLeft', 'Slash'])
    assert.equal(isBindableCode(code), true);
  assert.equal(keyLabel('KeyZ'), 'Z');
  assert.equal(keyLabel('Digit7'), '7');
  assert.equal(keyLabel('ArrowLeft'), '←');
  assert.equal(keyLabel('Space'), '空格');
  assert.equal(keyLabel('ShiftLeft'), '左Shift');
  assert.equal(keyLabel('Numpad4'), '小键盘4');
  assert.equal(keyLabel('Escape'), 'Esc');
  assert.equal(keyLabel('unknown'), '未设置');
});

test('incomplete, conflicting, unsafe and prototype-bearing records revert to a complete safe mapping', () => {
  const incomplete = defaults();delete incomplete.left;
  const conflict = defaults();conflict.brake[0] = 'KeyW';
  const duplicate = defaults();duplicate.throttle = ['KeyW', 'KeyW'];
  const unsafe = defaults();unsafe.pause = ['Tab'];
  const empty = defaults();empty.nitro = [];
  const long = defaults();long.nitro.push('KeyZ');
  const unknown = { ...defaults(), unknown: ['KeyZ'] };
  const inherited = Object.create(defaults());
  const poisoned = JSON.parse(JSON.stringify(defaults()).replace('{', '{"__proto__":{"polluted":true},'));
  for (const value of [incomplete, conflict, duplicate, unsafe, empty, long, unknown, inherited, poisoned, null, [], 4, 'keys'])
    assert.deepEqual(validateKeyBindings(value), DEFAULT_KEY_BINDINGS);
  assert.equal({}.polluted, undefined);
  const result = defaults();result.throttle[0] = 'KeyE';
  assert.deepEqual(defaults().throttle, ['KeyW', 'ArrowUp'], 'fallback returns fresh mutable copies');
  assert.deepEqual(validateKeyBindings(Object.assign(Object.create(null), defaults())), DEFAULT_KEY_BINDINGS);
});

test('saved remaps reload independently of touch settings and storage failures stay recoverable', () => {
  const values = new Map([['sunny-settings-v1', '{"buttonSize":76}'], ['sunny-touch-layout-v1', '{"landscape":{}}']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const custom = assignKeyBinding(DEFAULT_KEY_BINDINGS, 'throttle', 0, 'KeyE').bindings;
  assert.equal(saveKeyBindings(storage, custom), true);
  assert.equal(values.has(KEY_BINDINGS_STORAGE_KEY), true);
  assert.deepEqual(readKeyBindings(storage), custom);
  assert.equal(values.get('sunny-settings-v1'), '{"buttonSize":76}');
  assert.equal(values.get('sunny-touch-layout-v1'), '{"landscape":{}}');
  for (const invalid of ['{broken', 'null', '42', '[]']) {
    storage.setItem(KEY_BINDINGS_STORAGE_KEY, invalid);
    assert.deepEqual(readKeyBindings(storage), DEFAULT_KEY_BINDINGS);
  }
  assert.deepEqual(readKeyBindings({ getItem() { throw new Error('denied'); } }), DEFAULT_KEY_BINDINGS);
  assert.equal(saveKeyBindings({ setItem() { throw new Error('quota'); } }, custom), false);
  assert.equal(saveKeyBindings(undefined, custom), false);
});

test('malformed assignments and absent input state never throw or disable the current mapping', () => {
  for (const [action, slot] of [['unknown', 0], ['__proto__', 0], ['left', -1], ['left', 2], ['left', .5]]) {
    const result = assignKeyBinding(DEFAULT_KEY_BINDINGS, action, slot, 'KeyZ');
    assert.ok(result.error);
    assert.deepEqual(result.bindings, DEFAULT_KEY_BINDINGS);
  }
  assert.equal(isActionPressed(undefined, DEFAULT_KEY_BINDINGS, 'throttle'), false);
  assert.equal(isActionPressed(new Set(['KeyW']), DEFAULT_KEY_BINDINGS, 'unknown'), false);
  assert.equal(actionForKey(undefined, 'KeyW'), undefined);
});
