import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { GameSettings } from '../src/settings.js';
import { TouchControls } from '../src/touch-controls.js';
import { CONTROL_ACTIONS, CONTROL_LAYOUT_STORAGE_KEY } from '../src/control-layout.js';
import { CoursePicker } from '../src/course-picker.js';
import { TRACK_CATALOG } from '../src/game/track.js';
import { installBrowserGuards } from '../src/browser-gestures.js';
import { UI } from '../src/ui.js';
import { createTrack } from '../src/game/track.js';

function fixture(t, storage) {
  const window=new Window({url:'http://localhost/'}),document=window.document;
  document.body.innerHTML=`<div id="app"><button class="settings-button">设置</button><div class="menu-copy"><div class="difficulty-row"></div></div><div class="touch-controls">${CONTROL_ACTIONS.map(action=>`<button data-touch="${action}">${action}</button>`).join('')}</div></div>`;
  const root=document.querySelector('#app');let width=844,height=390;
  root.getBoundingClientRect=()=>({width,height,left:0,top:0});
  const values=new Map(),backing=storage||{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  t.after(()=>window.close());
  return {window,document,root,storage:backing,resize(w,h){width=w;height=h;window.dispatchEvent(new window.Event('resize'));}};
}

function drag(f,button,dx,dy){
  const x=parseFloat(button.style.left),y=parseFloat(button.style.top);
  for(const [type,clientX,clientY] of [['pointerdown',x,y],['pointermove',x+dx,y+dy],['pointerup',x+dx,y+dy]])
    button.dispatchEvent(new f.window.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,pointerType:'touch',clientX,clientY,button:0}));
}

test('settings keep driving blocked during layout editing; drag, save, cancel and reload operate on the actual controls', t=>{
  const f=fixture(t);let paused=false;
  const settings=new GameSettings(f.root,{storage:f.storage,onOpen:()=>{paused=true;},onClose:()=>{paused=false;}});
  const state={},controls=new TouchControls(f.root.querySelectorAll('[data-touch]'),{state,windowTarget:f.window,documentTarget:f.document});
  t.after(()=>controls.destroy());
  settings.open();f.root.querySelector('.settings-custom-layout').click();
  assert.equal(settings.isOpen,true);assert.equal(paused,true);assert.equal(settings.overlay.hidden,true);
  const left=f.root.querySelector('[data-layout-action="left"]');
  drag(f,left,24,-80);
  assert.equal(state.throttle,0);assert.equal(state.steer,0,'preview controls never send driving input');
  const expectedX=parseFloat(left.style.left),expectedY=parseFloat(left.style.top);
  f.root.querySelector('.control-editor-save').click();
  assert.equal(settings.overlay.hidden,false);assert.equal(settings.layoutEditor.isOpen,false);assert.equal(paused,true);
  assert.equal(f.root.dataset.customControls,'true');
  const actual=f.root.querySelector('[data-touch="left"]');
  assert.equal(parseFloat(actual.style.left),expectedX);assert.equal(parseFloat(actual.style.top),expectedY);
  const saved=f.storage.getItem(CONTROL_LAYOUT_STORAGE_KEY);
  f.root.querySelector('.settings-custom-layout').click();drag(f,left,20,-20);f.root.querySelector('.control-editor-cancel').click();
  assert.equal(f.storage.getItem(CONTROL_LAYOUT_STORAGE_KEY),saved);assert.equal(parseFloat(actual.style.left),expectedX);
  settings.close();assert.equal(paused,false);
  const reload=fixture(t,f.storage),restored=new GameSettings(reload.root,{storage:f.storage});
  assert.equal(reload.root.dataset.customControls,'true');assert.equal(parseFloat(reload.root.querySelector('[data-touch="left"]').style.left),expectedX);
  restored.open();reload.root.querySelector('.settings-reset').click();
  assert.equal(reload.root.dataset.customControls,'false');assert.equal(restored.layoutEditor.hasCustom(),false);
});

test('layout save errors are visible and a too-small saved layout uses a safe preset without deleting it', t=>{
  const f=fixture(t,{getItem:()=>null,setItem(){throw new Error('quota');}});
  const settings=new GameSettings(f.root,{storage:f.storage});settings.open();
  f.root.querySelector('.settings-custom-layout').click();drag(f,f.root.querySelector('[data-layout-action="left"]'),20,-70);
  f.root.querySelector('.control-editor-save').click();
  assert.match(f.root.querySelector('.settings-save-status').textContent,/未能保存/);
  assert.equal(f.root.dataset.customControls,'true');
  f.resize(390,844);assert.equal(f.root.dataset.customControls,'false','other orientation has an independent preset');
  f.resize(844,390);assert.equal(f.root.dataset.customControls,'true');
  const stored=settings.layoutEditor.layouts.landscape;
  f.resize(320,200);assert.equal(f.root.dataset.customControls,'false');assert.deepEqual(settings.layoutEditor.layouts.landscape,stored);
});

test('the seventh item control can be moved and saved independently without changing the original six positions', t=>{
  const f=fixture(t),settings=new GameSettings(f.root,{storage:f.storage});settings.open();
  f.root.querySelector('.settings-custom-layout').click();
  const existing=['left','right','drift','nitro','brake','throttle'];
  const before=Object.fromEntries(existing.map(action=>{const button=f.root.querySelector(`[data-layout-action="${action}"]`);return[action,{left:button.style.left,top:button.style.top}];}));
  const item=f.root.querySelector('[data-layout-action="useItem"]');drag(f,item,90,-30);
  const expected={left:item.style.left,top:item.style.top};f.root.querySelector('.control-editor-save').click();
  assert.equal(settings.layoutEditor.isOpen,false);assert.ok(JSON.parse(f.storage.getItem(CONTROL_LAYOUT_STORAGE_KEY)).landscape.useItem);
  const reloaded=fixture(t,f.storage);new GameSettings(reloaded.root,{storage:f.storage});
  for(const action of existing){const button=reloaded.root.querySelector(`[data-touch="${action}"]`);assert.equal(button.style.left,before[action].left);assert.equal(button.style.top,before[action].top);}
  const actual=reloaded.root.querySelector('[data-touch="useItem"]');assert.equal(actual.style.left,expected.left);assert.equal(actual.style.top,expected.top);
});

test('course picker exposes four distinct previews, selection callback, Escape and loading lock', t=>{
  const f=fixture(t);let chosen;
  const picker=new CoursePicker(f.root,{onSelect:id=>{chosen=id;picker.setSelected(id);}});
  assert.equal(f.root.querySelectorAll('[data-course]').length,4);
  assert.equal(new Set([...f.root.querySelectorAll('.preview-road')].map(route=>route.getAttribute('points'))).size,4);
  for(const course of TRACK_CATALOG){picker.button.click();assert.equal(picker.overlay.hidden,false);f.root.querySelector(`[data-course="${course.id}"]`).click();assert.equal(chosen,course.id);assert.equal(picker.overlay.hidden,true);assert.equal(picker.button.querySelector('strong').textContent,course.name);}
  picker.open();picker.overlay.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(picker.overlay.hidden,true);
  picker.setBusy(true);picker.open();assert.equal(picker.overlay.hidden,true);assert.equal(picker.button.disabled,true);
});

test('gesture prevention keeps room-code copying, form editing and modal scrolling usable', t=>{
  const f=fixture(t),remove=installBrowserGuards(f.document);t.after(remove);
  f.root.insertAdjacentHTML('beforeend','<div class="race-hud"><button class="auto-throttle-button">自动油门</button><span class="speed-value">100</span></div><div class="dialog"><input value="房间号"><strong class="room-code">ABC234</strong></div>');
  const fire=(selector,type)=>{const event=new f.window.Event(type,{bubbles:true,cancelable:true});f.root.querySelector(selector).dispatchEvent(event);return event.defaultPrevented;};
  assert.equal(fire('.speed-value','contextmenu'),true);
  assert.equal(fire('[data-touch="left"]','touchstart'),true);
  assert.equal(fire('.auto-throttle-button','touchstart'),false,'ordinary HUD buttons keep compatibility clicks');
  assert.equal(fire('input','contextmenu'),false);assert.equal(fire('.room-code','selectstart'),false);
  assert.equal(fire('.dialog','touchmove'),false,'settings can scroll normally');
  assert.equal(fire('[data-touch="left"]','touchmove'),true);
});

test('the full game UI switches course labels without duplicating HUD and blocks starts while a map loads',t=>{
  const f=fixture(t),originals=new Map();
  for(const [key,value] of Object.entries({window:f.window,document:f.document,navigator:f.window.navigator,innerWidth:844,innerHeight:390})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value,writable:true});
  }
  t.after(()=>{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const ui=new UI();
  for(const course of TRACK_CATALOG){ui.setCourse(createTrack(course.id));assert.equal(f.root.querySelectorAll('.course-zone').length,1);assert.equal(f.root.querySelector('.course-stamp strong').textContent,course.name);}
  ui.setLoading(.5);assert.equal(f.root.querySelector('.start-button').disabled,true);assert.equal(f.root.querySelector('.friend-button').disabled,true);
  ui.showLobby({status:'lobby',hostId:'a',selfId:'a',players:[{id:'a'},{id:'b'}]});assert.equal(f.root.querySelector('.start-room-button').disabled,true);
  ui.setLoading(1);assert.equal(f.root.querySelector('.start-room-button').disabled,false);
  ui.enterRace();assert.equal(f.root.classList.contains('in-race'),true);ui.showMenu();assert.equal(f.root.classList.contains('in-race'),false);
});
