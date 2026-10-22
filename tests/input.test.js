import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { drivingInput } from '../src/input.js';
import { stepKartPhysics } from '../src/game/physics.js';
import { DEFAULT_KEY_BINDINGS, assignKeyBinding } from '../src/keyboard-bindings.js';

test('left/right keyboard and touch controls turn toward the matching side of the chase camera',()=>{
  for(const heading of [0,.8,2.4,-2.6]) {
    const tx=Math.sin(heading),tz=Math.cos(heading),nx=tz,nz=-tx;
    const track={length:10000,width:16,railOffset:11,sample:d=>({x:tx*d,y:5,z:tz*d,tx,tz,nx,nz,heading,curvature:0,slope:0})};
    const camera=new THREE.PerspectiveCamera(53,16/9,.2,1000);
    camera.position.set(-tx*11,10,-tz*11);camera.lookAt(tx*14,6.7,tz*14);camera.updateMatrixWorld();
    for(const [direction,screenSign] of [['ArrowLeft',-1],['ArrowRight',1]]) {
      for(const touch of [false,true]) {
        const input=touch?drivingInput(new Set(),{throttle:1,steer:screenSign}):drivingInput(new Set(['KeyW',direction]));
        const r={distance:0,offset:0,speed:22,lateralVelocity:0,yaw:0,yawRate:0};
        for(let i=0;i<42;i++)stepKartPhysics(r,input,track,1/120);
        const p=track.sample(r.distance);
        const center=new THREE.Vector3(p.x,5,p.z).project(camera);
        const car=new THREE.Vector3(p.x+nx*r.offset,5,p.z+nz*r.offset).project(camera);
        assert.ok((car.x-center.x)*screenSign>.01,`${direction}, touch=${touch}, heading=${heading}`);
      }
    }
  }
});
test('opposite steering cancels, throttle and brake remain independent, and combined input stays bounded',()=>{
  assert.equal(drivingInput(new Set(['ArrowLeft','ArrowRight'])).steer,0);
  assert.equal(drivingInput(new Set(['KeyA','ArrowLeft']),{steer:-1}).steer,1);
  const input=drivingInput(new Set(['KeyS','Space','ShiftLeft']),{},true);
  assert.equal(input.throttle,1);assert.equal(input.brake,1);assert.equal(input.nitro,true);assert.equal(input.drift,true);
});

test('custom sensitivity softens either control method without reversing it; modals brake instead of continuing automatic throttle',()=>{
  for(const touch of [false,true]){
    const keys=new Set(touch?[]:['ArrowLeft']);const state=touch?{steer:-1}:{};
    const full=drivingInput(keys,state,true),soft=drivingInput(keys,state,true,{sensitivity:.5});
    assert.equal(soft.steer,full.steer*.5);assert.equal(soft.throttle,1);
  }
  assert.deepEqual(drivingInput(new Set(['KeyW','KeyA','Space','KeyE']),{drift:true,useItem:true},true,{blocked:true}),{throttle:0,brake:1,steer:0,drift:false,nitro:false,useItem:false});
});

test('custom keyboard mappings drive the same physics inputs and replacing both keys retires the defaults',()=>{
  let bindings=DEFAULT_KEY_BINDINGS;
  const custom={throttle:['KeyI','Numpad8'],brake:['KeyK','Numpad5'],left:['KeyJ','Numpad4'],right:['KeyL','Numpad6'],drift:['KeyU','Numpad7'],nitro:['KeyO','Numpad9']};
  for(const [action,codes] of Object.entries(custom))for(const [slot,code] of codes.entries()){
    const result=assignKeyBinding(bindings,action,slot,code);assert.equal(result.error,null);bindings=result.bindings;
  }
  assert.deepEqual(drivingInput(new Set(['KeyI','KeyK','KeyJ','KeyU','KeyO']),{},false,{bindings}),{throttle:1,brake:1,steer:1,drift:true,nitro:true,useItem:false});
  assert.equal(drivingInput(new Set(['KeyL']),{},false,{bindings}).steer,-1);
  assert.deepEqual(drivingInput(new Set(['KeyW','ArrowUp','KeyS','ArrowDown','KeyA','ArrowLeft','ArrowRight','KeyD','ShiftLeft','Space']),{},false,{bindings}),{throttle:0,brake:0,steer:0,drift:false,nitro:false,useItem:false});
  assert.equal(drivingInput(new Set(['Numpad8']),{brake:1,steer:-1},false,{bindings}).throttle,1);
  assert.deepEqual(drivingInput(new Set(['KeyI']),{},true,{bindings,blocked:true}),{throttle:0,brake:1,steer:0,drift:false,nitro:false,useItem:false});
});

test('item input has its own remappable keyboard and touch action, independent from nitro',()=>{
  for(const input of [drivingInput(new Set(['KeyE'])),drivingInput(new Set(),{useItem:true})]) {
    assert.equal(input.useItem,true);assert.equal(input.nitro,false);
  }
  assert.equal(drivingInput(new Set(['Space'])).useItem,false);
  const {bindings,error}=assignKeyBinding(DEFAULT_KEY_BINDINGS,'useItem',0,'KeyF');assert.equal(error,null);
  assert.equal(drivingInput(new Set(['KeyE']),{},false,{bindings}).useItem,false);
  const combined=drivingInput(new Set(['KeyF','Space','KeyW']),{},false,{bindings});
  assert.equal(combined.useItem,true);assert.equal(combined.nitro,true);assert.equal(combined.throttle,1);
});
