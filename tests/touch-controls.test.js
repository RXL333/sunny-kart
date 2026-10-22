import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchControls } from '../src/touch-controls.js';
import { drivingInput } from '../src/input.js';

class Target {
  constructor(action) {
    this.handlers = new Map();this.dataset = { touch: action };this.captures = new Set();this.attrs = {};
    this.classes = new Set();this.classList = { toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
  }
  addEventListener(type, callback) { if (!this.handlers.has(type)) this.handlers.set(type, new Set());this.handlers.get(type).add(callback); }
  removeEventListener(type, callback) { this.handlers.get(type)?.delete(callback); }
  setAttribute(name, value) { this.attrs[name] = value; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id);this.emit('lostpointercapture', id); }
  closest() { return this; }
  emit(type, pointerId, extra = {}) {
    const event = { pointerId, pointerType: 'touch', button: 0, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    for (const handler of this.handlers.get(type) || []) handler(event);
    return event;
  }
}

function setup(t) {
  const buttons = Object.fromEntries(['left', 'right', 'throttle', 'brake', 'drift', 'nitro', 'useItem'].map(action => [action, new Target(action)]));
  const win = new Target(), doc = new Target(), state = {};
  let hit = null;doc.elementFromPoint = () => hit;
  const controls = new TouchControls(Object.values(buttons), { state, windowTarget: win, documentTarget: doc });
  t.after(() => controls.destroy());
  return { buttons, win, doc, state, controls, setHit: value => { hit = value; } };
}

test('simultaneous throttle, steering, drift, nitro and item use remain independent and map to the corrected direction', t => {
  const { buttons: b, state } = setup(t);
  for (const [id, action] of ['throttle', 'left', 'drift', 'nitro', 'useItem'].entries()) assert.ok(b[action].emit('pointerdown', id).prevented);
  assert.deepEqual(state, { throttle: 1, brake: 0, steer: -1, drift: true, nitro: true, useItem: true });
  assert.equal(drivingInput(new Set(), state).steer, 1, 'human left stays correct in game coordinates');
  b.left.emit('pointerup', 1);
  assert.deepEqual(state, { throttle: 1, brake: 0, steer: 0, drift: true, nitro: true, useItem: true });
  b.nitro.emit('pointercancel', 3);
  assert.equal(state.nitro, false);assert.equal(state.throttle, 1);assert.equal(state.drift, true);assert.equal(state.useItem,true);
  b.useItem.emit('pointerup', 4);assert.equal(state.useItem,false);assert.equal(state.drift,true);
});

test('two fingers on one action and opposite directions cannot release each other', t => {
  const { buttons: b, state } = setup(t);
  b.left.emit('pointerdown', 10);b.left.emit('pointerdown', 11);b.right.emit('pointerdown', 12);
  assert.equal(state.steer, 0);
  b.left.emit('pointerup', 10);assert.equal(state.steer, 0);assert.equal(b.left.attrs['aria-pressed'], 'true');
  b.right.emit('pointercancel', 12);assert.equal(state.steer, -1);
  b.left.emit('pointerup', 11);assert.equal(state.steer, 0);assert.equal(b.left.attrs['aria-pressed'], 'false');
  b.left.emit('pointercancel', 11);assert.equal(state.steer, 0, 'duplicate release is harmless');
});

test('a captured thumb slides between directions and neutral space without affecting other fingers', t => {
  const { buttons: b, state, setHit } = setup(t);
  b.left.emit('pointerdown', 1);b.throttle.emit('pointerdown', 2);
  setHit(b.right);b.left.emit('pointermove', 1, { clientX: 100, clientY: 200 });
  assert.equal(state.steer, 1);assert.equal(b.right.attrs['aria-pressed'], 'true');assert.equal(b.left.attrs['aria-pressed'], 'false');
  assert.ok(b.left.hasPointerCapture(1), 'capture ownership remains on the original element');
  setHit(null);b.left.emit('pointermove', 1);assert.equal(state.steer, 0);assert.equal(state.throttle, 1);
  setHit(b.left);b.left.emit('pointermove', 1);assert.equal(state.steer, -1);
  b.left.releasePointerCapture(1);assert.equal(state.steer, 0);assert.equal(state.throttle, 1);
});

test('blur, viewport rotation, hidden pages and explicit clear release every action and visual state', t => {
  const { buttons: b, state, controls, win, doc } = setup(t);
  const neutral = { throttle: 0, brake: 0, steer: 0, drift: false, nitro: false, useItem: false };
  for (const clear of [() => win.emit('blur'), () => win.emit('resize'), () => win.emit('orientationchange'), () => win.emit('pagehide'), () => { doc.hidden = true;doc.emit('visibilitychange'); }, () => controls.clear()]) {
    b.throttle.emit('pointerdown', 1);b.right.emit('pointerdown', 2);b.brake.emit('pointerdown', 3);b.drift.emit('pointerdown', 4);b.nitro.emit('pointerdown',5);b.useItem.emit('pointerdown',6);
    clear();assert.deepEqual(state, neutral);assert.equal(controls.pointers.size, 0);
    for (const button of Object.values(b)) { assert.equal(button.attrs['aria-pressed'], 'false');assert.equal(button.classes.has('pressed'), false);assert.equal(button.captures.size, 0); }
  }
});

test('two fingers holding the item button and steering sliding over it retain separate ownership', t => {
  const {buttons:b,state,setHit}=setup(t);
  b.useItem.emit('pointerdown',1);b.useItem.emit('pointerdown',2);b.left.emit('pointerdown',3);
  b.useItem.emit('pointerup',1);assert.equal(state.useItem,true);
  setHit(b.useItem);b.left.emit('pointermove',3);assert.equal(state.steer,0);assert.equal(state.useItem,true);
  b.useItem.emit('pointercancel',2);assert.equal(state.useItem,false);
  b.left.emit('pointermove',3);assert.equal(state.useItem,false,'sliding steering never synthesizes an item press');
  assert.equal(state.nitro,false);
});

test('window release covers unavailable pointer capture; right mouse clicks and destroyed bindings do nothing', t => {
  const { buttons: b, state, controls, win } = setup(t);
  b.throttle.setPointerCapture = () => { throw new Error('capture unavailable'); };
  b.throttle.emit('pointerdown', 1);assert.equal(state.throttle, 1);
  win.emit('pointerup', 1);assert.equal(state.throttle, 0);
  b.right.emit('pointerdown', 2, { pointerType: 'mouse', button: 2 });assert.equal(state.steer, 0);
  controls.destroy();b.throttle.emit('pointerdown', 3);assert.equal(state.throttle, 0);
});
