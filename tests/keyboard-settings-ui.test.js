import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { GameSettings } from '../src/settings.js';
import { CONTROL_ACTIONS, CONTROL_LAYOUT_STORAGE_KEY, resolveControlPositions, normalizeControlPositions } from '../src/control-layout.js';
import { KEYBOARD_ACTIONS, DEFAULT_KEY_BINDINGS, KEY_BINDINGS_STORAGE_KEY, keyLabel } from '../src/keyboard-bindings.js';

function fixture(t, { storage, mode = 'keyboard', onBindingsChange } = {}) {
  const window = new Window({ url: 'http://localhost/' }), document = window.document;
  document.body.innerHTML = `<div id="app"><button class="settings-button">设置</button><div class="touch-controls">${CONTROL_ACTIONS.map(action => `<button data-touch="${action}">${action}</button>`).join('')}</div></div>`;
  const root = document.querySelector('#app');
  if (mode) root.dataset.inputMode = mode;
  root.getBoundingClientRect = () => ({ width:844, height:390, left:0, top:0 });
  const saved = new Map(), backing = storage || { getItem:key => saved.get(key), setItem:(key,value) => saved.set(key,value) };
  const settings = new GameSettings(root, { storage:backing, onBindingsChange });
  t.after(() => window.close());
  return { window, document, root, settings, storage:backing, saved,
    button:(action,slot=0) => root.querySelector(`[data-binding-action="${action}"][data-binding-slot="${slot}"]`),
    press(code, options = {}) { const event = new window.KeyboardEvent('keydown', { key:code.startsWith('Key')?code.slice(3).toLowerCase():code, code, bubbles:true, cancelable:true, ...options });document.activeElement.dispatchEvent(event);return event; },
  };
}

test('device mode chooses the matching settings panel, while tabs retain access to either device', t => {
  const f = fixture(t);f.settings.open();
  assert.equal(f.root.querySelector('.settings-keyboard-panel').hidden, false);
  assert.equal(f.root.querySelector('.settings-touch-panel').hidden, true);
  assert.equal(f.root.querySelectorAll('.settings-keyboard-row').length, KEYBOARD_ACTIONS.length);
  f.root.querySelector('[data-control-mode="touch"]').click();
  assert.equal(f.root.querySelector('.settings-touch-panel').hidden, false);
  assert.equal(f.root.querySelector('.settings-keyboard-panel').hidden, true);
  assert.equal(f.root.querySelector('.settings-custom-layout').textContent.includes('自定义按键位置'), true);
  f.settings.setInputMode('keyboard');
  assert.equal(f.settings.activeControlMode, 'touch', 'changing actual input does not replace a manually selected open tab');
  f.settings.close();f.settings.open();assert.equal(f.settings.activeControlMode, 'keyboard');
  const phone = fixture(t,{ mode:'touch' });phone.settings.open();assert.equal(phone.settings.activeControlMode,'touch');
});

test('recording updates the chosen binding, notifies the game immediately and survives reload', t => {
  let changes = 0, latest;
  const f = fixture(t,{onBindingsChange:bindings => {changes++;latest=bindings;}});
  let leaked = 0;f.window.addEventListener('keydown',()=>leaked++);
  f.settings.open();f.button('throttle').click();
  const event = f.press('KeyI');
  assert.equal(event.defaultPrevented,true);assert.equal(leaked,0,'recorded gameplay keys do not reach the game window handler');
  assert.deepEqual(f.settings.bindings.throttle,['KeyI','ArrowUp']);
  assert.equal(f.button('throttle').textContent,'I');assert.equal(f.settings.recording,null);
  assert.equal(changes,1);assert.deepEqual(latest.throttle,['KeyI','ArrowUp']);
  assert.match(f.root.querySelector('.settings-save-status').textContent,/已改为 I/);
  assert.match(f.root.querySelector('.settings-key-record-status').textContent,/已改为 I/,'the feedback is also visible beside the mapping list');
  const reloaded = fixture(t,{storage:f.storage});assert.deepEqual(reloaded.settings.bindings.throttle,['KeyI','ArrowUp']);
  assert.equal(reloaded.button('throttle').textContent,'I');assert.ok(f.saved.has(KEY_BINDINGS_STORAGE_KEY));
  f.button('drift').click();f.press('KeyF');
  assert.match(f.root.querySelector('.settings-tip p').textContent,/F/,'desktop driving guidance uses current bindings');
});

test('conflicts, browser combinations and IME input leave the previous binding intact', t => {
  const f = fixture(t);f.settings.open();f.button('throttle').click();
  f.press('KeyS');assert.deepEqual(f.settings.bindings.throttle,DEFAULT_KEY_BINDINGS.throttle);
  assert.match(f.root.querySelector('.settings-save-status').textContent,/刹车|占用|使用/);assert.ok(f.settings.recording);
  const combo=f.press('KeyL',{ctrlKey:true});assert.equal(combo.defaultPrevented,false,'browser shortcuts remain available');
  assert.deepEqual(f.settings.bindings.throttle,DEFAULT_KEY_BINDINGS.throttle);
  f.press('KeyJ',{isComposing:true});assert.deepEqual(f.settings.bindings.throttle,DEFAULT_KEY_BINDINGS.throttle);
  f.press('F5');assert.deepEqual(f.settings.bindings.throttle,DEFAULT_KEY_BINDINGS.throttle);
  f.press('KeyI');assert.deepEqual(f.settings.bindings.throttle,['KeyI','ArrowUp']);
});

test('Escape, Tab, blur, tab switching and closing all cancel an unfinished recording', t => {
  const f = fixture(t);f.settings.open();
  for (const cancel of [
    () => f.press('Escape',{key:'Escape'}),
    () => f.press('Tab',{key:'Tab'}),
    () => f.window.dispatchEvent(new f.window.Event('blur')),
    () => f.root.querySelector('[data-setting="soundVolume"]').dispatchEvent(new f.window.PointerEvent('pointerdown',{bubbles:true})),
    () => f.root.querySelector('[data-control-mode="touch"]').click(),
    () => f.settings.close(),
  ]) {
    if(!f.settings.isOpen)f.settings.open();f.settings.selectControlMode('keyboard');f.button('throttle').click();
    assert.ok(f.settings.recording);cancel();assert.equal(f.settings.recording,null);
    assert.deepEqual(f.settings.bindings.throttle,DEFAULT_KEY_BINDINGS.throttle);
  }
  f.settings.open();f.button('throttle').click();f.press('Escape',{key:'Escape'});
  assert.equal(f.settings.isOpen,true,'first Escape cancels recording without closing settings');
  f.press('Escape',{key:'Escape'});assert.equal(f.settings.isOpen,false);
  f.settings.open();f.button('throttle').click();
  Object.defineProperty(f.document,'hidden',{configurable:true,value:true});f.document.dispatchEvent(new f.window.Event('visibilitychange'));
  assert.equal(f.settings.recording,null);
});

test('secondary bindings can be cleared and added, and saving failure is reported without losing active input', t => {
  const f = fixture(t,{storage:{getItem:()=>null,setItem(){throw new Error('quota');}}});
  f.settings.open();f.root.querySelector('[data-clear-binding="throttle"]').click();
  assert.deepEqual(f.settings.bindings.throttle,['KeyW']);assert.equal(f.root.querySelector('[data-clear-binding="throttle"]').disabled,true);
  assert.equal(f.button('throttle',1).textContent,'添加');
  f.button('throttle',1).click();f.press('KeyI');assert.deepEqual(f.settings.bindings.throttle,['KeyW','KeyI']);
  assert.match(f.root.querySelector('.settings-save-status').textContent,/未能保存/);
  assert.equal(f.button('throttle',1).textContent,keyLabel('KeyI'));
});

test('desktop default reset preserves saved phone positions; phone default reset preserves keyboard mappings', t => {
  const f = fixture(t);const {positions,geometry}=resolveControlPositions(null,{width:844,height:390});
  const layouts={version:1,landscape:normalizeControlPositions(positions,geometry),portrait:null};
  f.storage.setItem(CONTROL_LAYOUT_STORAGE_KEY,JSON.stringify(layouts));
  const reloaded=fixture(t,{storage:f.storage});reloaded.settings.open();
  reloaded.button('throttle').click();reloaded.press('KeyI');
  reloaded.root.querySelector('.settings-reset').click();
  assert.deepEqual(reloaded.settings.bindings,DEFAULT_KEY_BINDINGS);
  assert.equal(reloaded.storage.getItem(CONTROL_LAYOUT_STORAGE_KEY),JSON.stringify(layouts));
  assert.equal(reloaded.settings.layoutEditor.hasCustom(),true);
  reloaded.button('throttle').click();reloaded.press('KeyI');
  reloaded.root.querySelector('[data-control-mode="touch"]').click();reloaded.root.querySelector('.settings-reset').click();
  assert.equal(reloaded.settings.layoutEditor.hasCustom(),false);assert.deepEqual(reloaded.settings.bindings.throttle,['KeyI','ArrowUp']);
});

test('focus wrapping ignores hidden panel controls and device tabs work with keyboard arrows', t => {
  const f = fixture(t);f.settings.open();
  f.root.querySelector('.settings-done').focus();const wrapped=f.press('Tab',{key:'Tab'});
  assert.equal(wrapped.defaultPrevented,true);assert.ok(f.document.activeElement===f.root.querySelector('.settings-close'),'Tab at the footer wraps to the close button');
  const keyboardTab=f.root.querySelector('[data-control-mode="keyboard"]');keyboardTab.focus();f.press('ArrowRight',{key:'ArrowRight'});
  assert.equal(f.settings.activeControlMode,'touch');assert.ok(f.document.activeElement===f.root.querySelector('[data-control-mode="touch"]'),'arrow navigation focuses the selected tab');
  assert.equal(keyboardTab.tabIndex,-1);
  f.root.querySelector('.settings-close').focus();f.press('Tab',{key:'Tab',shiftKey:true});
  assert.ok(f.document.activeElement===f.root.querySelector('.settings-done'),'Shift Tab wraps to the footer rather than hidden phone settings');
});
