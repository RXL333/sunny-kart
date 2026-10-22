import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { RaceModePicker } from '../src/race-mode-picker.js';
import { ItemHUD } from '../src/item-hud.js';
import { DEFAULT_KEY_BINDINGS } from '../src/keyboard-bindings.js';

function fixture(t) {
  const window = new Window(), document = window.document;
  const previous = globalThis.document;
  globalThis.document = document;
  document.body.innerHTML = '<div id="app"><div class="start-actions"></div><section class="race-hud"></section><button data-touch="useItem"></button></div>';
  t.after(() => { globalThis.document = previous; window.close(); });
  return document.querySelector('#app');
}

test('race selection clearly changes the chosen mode and reports it to starting logic', t => {
  const root = fixture(t), changes = [];
  const picker = new RaceModePicker(root, { onChange: mode => changes.push(mode) });
  assert.equal(picker.mode, 'race');
  root.querySelector('[data-race-mode="items"]').click();
  assert.equal(picker.mode, 'items');
  assert.deepEqual(changes, ['items']);
  assert.equal(root.querySelector('[data-race-mode="items"]').getAttribute('aria-pressed'), 'true');
  assert.match(root.querySelector('.race-mode-detail').textContent, /五种道具/);
  picker.setMode('race');
  assert.equal(root.querySelector('[data-race-mode="items"]').getAttribute('aria-pressed'), 'false');
});

test('item slot and mobile key follow inventory, mode and custom keyboard keys', t => {
  const root = fixture(t), hud = new ItemHUD(root);
  hud.setBindings({ ...DEFAULT_KEY_BINDINGS, useItem: ['KeyV', 'Digit1'] });
  hud.update({ mode: 'race', player: { inventory: 'shield' } });
  assert.equal(hud.element.hidden, true);
  assert.equal(hud.button.hidden, true);
  hud.update({ mode: 'items', player: { inventory: null } });
  assert.equal(hud.element.hidden, false);
  assert.equal(hud.button.hidden, false);
  assert.equal(hud.button.getAttribute('aria-disabled'), 'true');
  assert.match(hud.element.textContent, /等待拾取/);
  hud.update({ mode: 'items', player: { inventory: 'bubble' } });
  assert.equal(hud.button.getAttribute('aria-label'), '使用泡泡弹');
  assert.equal(hud.button.getAttribute('aria-disabled'), 'false');
  assert.ok(hud.button.querySelector('svg'));
  assert.equal(hud.element.querySelector('kbd').textContent, 'V / 1');
  hud.update({ mode: 'time-trial', player: { inventory: null } });
  assert.equal(hud.element.hidden, true);
  assert.equal(hud.button.hidden, true);
});
