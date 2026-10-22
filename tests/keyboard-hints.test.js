import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { UI } from '../src/ui.js';
import { KEYBOARD_ACTIONS, DEFAULT_KEY_BINDINGS, assignKeyBinding } from '../src/keyboard-bindings.js';

function fixture(t){
  const window=new Window({url:'http://localhost/'});window.document.body.innerHTML='<div id="app"></div>';
  window.document.querySelector('#app').getBoundingClientRect=()=>({width:1440,height:900});
  const originals=new Map();
  for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,innerWidth:1440,innerHeight:900})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value,writable:true});
  }
  const ui=new UI();
  t.after(()=>{ui.mobile.destroy();ui.touchControls.destroy();window.close();for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return ui;
}

test('desktop defaults clearly name acceleration, braking and every driving action',t=>{
  const ui=fixture(t);
  for(const selector of ['.keyboard-guide','.race-hint']){
    const guide=ui.el(selector);assert.equal(guide.querySelectorAll('[data-action-hint]').length,KEYBOARD_ACTIONS.length);
    for(const {id:action} of KEYBOARD_ACTIONS)assert.ok(guide.querySelector(`[data-action-hint="${action}"] kbd`));
    assert.match(guide.querySelector('[data-action-hint="brake"]').textContent,/S.*↓.*刹车/);
    assert.match(guide.querySelector('[data-action-hint="useItem"]').textContent,/E.*使用道具/);
  }
  assert.equal(ui.root.dataset.inputMode,'keyboard');
});

test('changing a keyboard binding immediately updates every desktop hint while keeping the mobile help intact',t=>{
  const ui=fixture(t),mobileHelp=ui.el('.touch-help-list').innerHTML;
  let bindings=DEFAULT_KEY_BINDINGS;
  for(const [action,code] of [['throttle','KeyI'],['brake','KeyK'],['drift','KeyU'],['nitro','KeyO'],['useItem','KeyF'],['autoThrottle','KeyT'],['pause','KeyP'],['restart','KeyB']])bindings=assignKeyBinding(bindings,action,0,code).bindings;
  ui.setKeyBindings(bindings);
  assert.match(ui.el('.keyboard-guide [data-action-hint="throttle"]').textContent,/I/);
  assert.match(ui.el('.race-hint [data-action-hint="brake"]').textContent,/K/);
  assert.match(ui.el('.race-hint [data-action-hint="useItem"]').textContent,/F.*使用道具/);
  assert.match(ui.el('.nitro-panel small').textContent,/O/);
  assert.match(ui.el('.drift-heading > span:last-child').textContent,/U/);
  assert.equal(ui.el('.auto-throttle-button kbd').textContent,'T');
  assert.match(ui.el('.keyboard-help-list').textContent,/K.*刹车/);
  assert.match(ui.el('.keyboard-help-footnote').textContent,/P.*暂停.*B.*重新比赛/);
  assert.equal(ui.el('.touch-help-list').innerHTML,mobileHelp);
  ui.setOnline(true);ui.setKeyBindings(bindings);
  assert.ok(ui.all('[data-action-hint="pause"],[data-action-hint="restart"]').every(hint=>hint.hidden));
  assert.match(ui.el('.keyboard-help-footnote').textContent,/仅在单人模式/);
  ui.setOnline(false);assert.ok(ui.all('[data-action-hint="pause"],[data-action-hint="restart"]').every(hint=>!hint.hidden));
});
