import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { drivingInput } from '../src/input.js';
import { stepKartPhysics } from '../src/game/physics.js';

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
