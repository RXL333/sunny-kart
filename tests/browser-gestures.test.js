import test from 'node:test';
import assert from 'node:assert/strict';
import { browserGesturePolicy, installBrowserGuards } from '../src/browser-gestures.js';

const target = ({ native = false, game = false, play = false } = {}) => ({ closest(selector) {
  if (selector.startsWith('input,')) return native;
  if (selector === '#app,#game') return game;
  return play;
} });

test('game surfaces prevent callout and gesture interference while forms and room-code selection remain native', () => {
  assert.deepEqual(browserGesturePolicy(target({ game: true, play: true })), { selection: true, movement: true });
  assert.deepEqual(browserGesturePolicy(target({ game: true })), { selection: true, movement: false }, 'settings retain scroll gestures');
  assert.deepEqual(browserGesturePolicy(target({ native: true, game: true, play: true })), { selection: false, movement: false });
  assert.deepEqual(browserGesturePolicy(target()), { selection: false, movement: false }, 'outside the app is untouched');
  assert.deepEqual(browserGesturePolicy({ nodeType: 3, parentElement: target({ game: true }) }), { selection: true, movement: false });
});

test('guards cancel only targeted events and can be removed without blocking browser keyboard shortcuts', () => {
  const handlers = new Map();
  const doc = { addEventListener: (type, fn) => handlers.set(type, fn), removeEventListener: type => handlers.delete(type) };
  const remove = installBrowserGuards(doc);
  const fire = (type, element, cancelable = true) => {
    let prevented = false;
    handlers.get(type)({ target: element, cancelable, preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(fire('contextmenu', target({ game: true })), true);
  assert.equal(fire('contextmenu', target({ native: true, game: true })), false);
  assert.equal(fire('touchmove', target({ game: true })), false);
  assert.equal(fire('touchmove', target({ game: true, play: true })), true);
  assert.equal(fire('gesturestart', target({ game: true, play: true }), false), false);
  assert.equal(handlers.has('keydown'), false);
  remove(); assert.equal(handlers.size, 0);
});
