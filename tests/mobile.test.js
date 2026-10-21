import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileLayout,requestLandscape} from '../src/mobile.js';

test('phone controls survive landscape rotation and large touch tablets retain them',()=>{
  for(const [width,height] of [[390,844],[844,390],[667,375],[932,430],[1024,768],[1366,1024]])assert.equal(mobileLayout({width,height,touchPoints:5}).touch,true);
  assert.equal(mobileLayout({width:390,height:844,touchPoints:1}).phonePortrait,true);
  assert.equal(mobileLayout({width:844,height:390,touchPoints:1}).phonePortrait,false);
  assert.equal(mobileLayout({width:1440,height:900}).touch,false);
  assert.equal(mobileLayout({width:844,height:390}).hardwareTouch,false,'Responsive desktop previews must not silently enable automatic throttle');
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
