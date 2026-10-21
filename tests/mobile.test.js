import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {detectInputMode,mobileLayout,requestLandscape,MobileExperience} from '../src/mobile.js';

test('phone controls survive landscape rotation and large touch tablets retain them',()=>{
  for(const [width,height] of [[390,844],[844,390],[667,375],[932,430],[1024,768],[1366,1024]])assert.equal(mobileLayout({width,height,touchPoints:5}).touch,true);
  assert.equal(mobileLayout({width:390,height:844,touchPoints:1}).phonePortrait,true);
  assert.equal(mobileLayout({width:844,height:390,touchPoints:1}).phonePortrait,false);
  assert.equal(mobileLayout({width:1440,height:900}).touch,false);
  assert.equal(mobileLayout({width:844,height:390}).hardwareTouch,false,'Responsive desktop previews must not silently enable automatic throttle');
});
test('input mode follows actual pointer capabilities rather than desktop window size',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390]]){
    const desktop=mobileLayout({width,height,fine:true});
    assert.equal(desktop.touch,false);assert.equal(desktop.phonePortrait,false);
  }
  assert.equal(detectInputMode({coarse:true,touchPoints:5}),'touch');
  assert.equal(detectInputMode({fine:true,touchPoints:5}),'keyboard','a touch laptop starts with its primary mouse/trackpad');
  assert.equal(detectInputMode({fine:true,coarse:true,touchPoints:5}),'keyboard');
  assert.equal(detectInputMode({fine:true,touchPoints:5,lastInput:'touch'}),'touch');
  assert.equal(detectInputMode({coarse:true,touchPoints:5,lastInput:'keyboard'}),'keyboard');
  const laptop=mobileLayout({width:390,height:844,fine:true,touchPoints:5});
  assert.equal(laptop.hardwareTouch,true);assert.equal(laptop.touch,false);
  assert.equal(mobileLayout({width:390,height:844,coarse:true,inputMode:'keyboard'}).phonePortrait,false);
});

function modeFixture(t,{coarse=false,fine=false,touchPoints=0,width=844,height=390}={}) {
  const window=new Window({url:'http://localhost/'}),document=window.document;
  document.body.innerHTML='<div id="app"><button class="rotate-dismiss"></button><button class="rotate-fullscreen"></button><button class="fullscreen-button"></button><section class="rotate-overlay" hidden></section><div class="settings-overlay"><button class="record-key"></button></div><input class="name-input"><div class="editable" contenteditable="true"></div></div>';
  const root=document.querySelector('#app');
  Object.defineProperty(window.navigator,'maxTouchPoints',{configurable:true,value:touchPoints});
  const originalMatch=window.matchMedia.bind(window);
  window.matchMedia=query=>{const media=originalMatch(query);Object.defineProperty(media,'matches',{value:query==='(pointer: fine)'?fine:coarse,configurable:true});return media;};
  root.getBoundingClientRect=()=>({width,height,left:0,top:0});
  let clears=0,changes=0;const modes=[];
  root.addEventListener('inputmodechange',()=>changes++);
  const mobile=new MobileExperience(root,{clear:()=>clears++,mode:(...args)=>modes.push(args)});
  const key=(code,options={},target=root)=>target.dispatchEvent(new window.KeyboardEvent('keydown',{bubbles:true,code,key:code,...options}));
  const pointer=type=>root.dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,pointerType:type}));
  t.after(()=>{mobile.destroy();window.close();});
  return {window,root,mobile,key,pointer,modes,get clears(){return clears;},get changes(){return changes;},resize(w,h){width=w;height=h;window.dispatchEvent(new window.Event('resize'));}};
}

test('hybrid devices switch only on deliberate driving keys or actual touch, preserving safe editing',t=>{
  const f=modeFixture(t,{fine:true,touchPoints:5});
  assert.equal(f.root.dataset.inputMode,'keyboard');assert.equal(f.mobile.hardwareTouch,true);
  f.pointer('mouse');f.key('Tab');assert.equal(f.root.dataset.inputMode,'keyboard');
  f.pointer('touch');assert.equal(f.root.dataset.inputMode,'touch');assert.equal(f.root.classList.contains('touch-device'),true);
  for(const code of ['Tab','ControlLeft','AltLeft','MetaLeft'])f.key(code);
  f.key('KeyW',{isComposing:true});f.key('KeyW',{ctrlKey:true});f.key('KeyW',{altKey:true});f.key('KeyW',{metaKey:true});
  f.key('KeyW',{},f.root.querySelector('.record-key'));
  f.key('KeyW',{},f.root.querySelector('.name-input'));
  f.key('KeyW',{},f.root.querySelector('.editable'));
  assert.equal(f.root.dataset.inputMode,'touch','recording, form text, system shortcuts and IME do not switch the phone UI');
  f.key('KeyW');assert.equal(f.root.dataset.inputMode,'keyboard');assert.equal(f.root.classList.contains('touch-device'),false);
  assert.deepEqual(f.modes,[[false,true,'keyboard'],[true,true,'touch'],[false,true,'keyboard']]);
  assert.equal(f.changes,3);assert.ok(f.clears>=2,'switching mode clears held controls');
  f.pointer('touch');f.key('ShiftLeft');assert.equal(f.root.dataset.inputMode,'keyboard','a Shift drift binding also activates keyboard mode before steering');
});

test('mouse-only computers ignore synthetic touch; phone rotation and portrait fallback still work',t=>{
  const desktop=modeFixture(t,{fine:true,width:390,height:844});
  desktop.pointer('touch');assert.equal(desktop.mobile.inputMode,'keyboard');assert.equal(desktop.mobile.blocked,false);
  const f=modeFixture(t,{coarse:true,touchPoints:5,width:390,height:844});
  assert.equal(f.root.dataset.inputMode,'touch');f.root.classList.add('in-race');f.mobile.beginRace();
  assert.equal(f.mobile.blocked,true);assert.equal(f.root.querySelector('.rotate-overlay').hidden,false);
  f.resize(844,390);assert.equal(f.mobile.blocked,false);assert.equal(f.root.classList.contains('mobile-landscape'),true);
  f.resize(390,844);assert.equal(f.mobile.blocked,true);
  f.root.querySelector('.rotate-dismiss').click();assert.equal(f.mobile.blocked,false);
  f.key('KeyW');assert.equal(f.mobile.inputMode,'keyboard');assert.equal(f.root.classList.contains('phone-portrait'),false);
  const count=f.changes;f.mobile.destroy();f.pointer('touch');assert.equal(f.changes,count,'destroy removes mode input listeners');
});
test('fullscreen precedes orientation lock and uses the actual API result',async()=>{
  const calls=[],doc={fullscreenElement:null,documentElement:{requestFullscreen:async()=>{calls.push('fullscreen');doc.fullscreenElement={};}}};
  const result=await requestLandscape(doc,{orientation:{lock:async mode=>calls.push(mode)}});
  assert.deepEqual(calls,['fullscreen','landscape']);assert.deepEqual(result,{fullscreen:true,locked:true});
});
test('unsupported or denied fullscreen and rotation leave portrait fallback playable',async()=>{
  assert.deepEqual(await requestLandscape({documentElement:{}},{}),{fullscreen:false,locked:false});
  const doc={documentElement:{requestFullscreen:async()=>{throw new Error('denied');}}};
  assert.deepEqual(await requestLandscape(doc,{orientation:{lock:async()=>{throw new Error('unsupported');}}}),{fullscreen:false,locked:false});
});
