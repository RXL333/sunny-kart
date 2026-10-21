import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { track } from '../src/game/track.js';
import { viewportProfile, cameraFov, chaseFraming, chaseEye } from '../src/viewport.js';

test('renderer follows the CSS canvas through phone rotation, browser bars and fullscreen',()=>{
  for(const [width,height] of [[390,844],[844,390],[667,375],[932,430],[1024,768],[1440,900]]) {
    const profile=viewportProfile({rect:{width,height},width:9999,height:9999,pixelRatio:3,touch:width<=1024});
    assert.equal(profile.width,width);assert.equal(profile.height,height);assert.equal(profile.aspect,width/height);
    assert.equal(profile.pixelRatio,width<=1024?1.25:1.75);
    assert.equal(profile.shadowSize,width<=1024?1024:2048);
  }
  const visible=viewportProfile({rect:{width:844,height:332},visualViewport:{width:844,height:332},width:844,height:390,touch:true});
  assert.equal(visible.aspect,844/332,'Canvas CSS height wins over the larger layout viewport');
  assert.deepEqual(viewportProfile({rect:{width:0,height:NaN},visualViewport:{width:667,height:320}}),{width:667,height:320,aspect:667/320,touch:true,pixelRatio:1,shadowSize:1024});
});

test('landscape camera remains familiar and portrait fallback preserves road visibility',()=>{
  for(const aspect of [844/390,667/375,932/430,16/9])assert.equal(cameraFov(58,aspect),58);
  const aspect=390/844,fov=cameraFov(53,aspect);
  assert.ok(fov>80&&fov<=88);
  const horizontal=2*Math.atan(Math.tan(fov*Math.PI/360)*aspect)*180/Math.PI;
  assert.ok(horizontal>=45.99);
  const camera=new THREE.PerspectiveCamera(fov,aspect,.2,1900);
  camera.position.set(0,5.8,-11.5);camera.lookAt(0,1.7,14);camera.updateMatrixWorld();
  const left=new THREE.Vector3(-1,1,0).project(camera),right=new THREE.Vector3(1,1,0).project(camera);
  assert.ok((right.x-left.x)/2<.25,'The kart occupies under a quarter of portrait width');
  assert.equal(cameraFov(53,.1),88,'Extreme narrow viewports stay below a fisheye view');
});

test('graphics choices change rendering cost without changing the CSS canvas or camera aspect',()=>{
  for(const touch of [false,true]) {
    const input={rect:{width:844,height:390},pixelRatio:3,touch};
    const smooth=viewportProfile({...input,quality:'smooth'}),sharp=viewportProfile({...input,quality:'sharp'});
    assert.equal(smooth.pixelRatio,1);assert.equal(smooth.shadowSize,512);
    assert.equal(sharp.pixelRatio,1.75);assert.equal(sharp.shadowSize,2048);
    assert.equal(smooth.aspect,sharp.aspect);assert.equal(smooth.width,sharp.width);assert.equal(smooth.height,sharp.height);
    assert.deepEqual(viewportProfile({...input,quality:'invalid'}),viewportProfile({...input,quality:'auto'}));
  }
  const lowResolution=viewportProfile({rect:{width:390,height:844},pixelRatio:1,touch:true,quality:'sharp'});
  assert.equal(lowResolution.pixelRatio,1,'Sharp mode does not invent extra device pixels');
});

test('short landscape camera keeps the original kart assets above the bottom HUD across bends and slopes',async()=>{
  const bounds=[];
  for(const file of ['kart.glb','kart-rabbit.glb','kart-panda.glb']) {
    const bytes=await fs.readFile(new URL(`../public/models/${file}`,import.meta.url));
    const model=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
    bounds.push({file,box:new THREE.Box3().setFromObject(model)});
  }
  for(const [width,height] of [[667,375],[844,390],[932,430]]) {
    const viewport=viewportProfile({width,height,touch:true});
    for(const speed of [0,28,45])for(const offset of [-8,0,8])for(const yaw of [-.45,0,.45])for(const distance of [740,900,...Array.from({length:Math.ceil(track.length/40)},(_,i)=>i*40)]) {
      const framing=chaseFraming(viewport,speed),eye=chaseEye(track,distance,offset,framing),p=track.sample(distance),ahead=track.sample(distance+framing.ahead);
      const camera=new THREE.PerspectiveCamera(cameraFov(53+speed*.17,viewport.aspect),viewport.aspect,.2,1900);
      camera.position.set(eye.x,eye.y,eye.z);camera.lookAt(ahead.x+ahead.nx*offset*.65,ahead.y+framing.targetHeight,ahead.z+ahead.nz*offset*.65);camera.updateMatrixWorld();
      const kart=new THREE.Group();kart.position.set(p.x+p.nx*offset,p.y+.08,p.z+p.nz*offset);kart.rotation.set(-p.pitch,p.heading+yaw,0,'YXZ');kart.updateMatrixWorld();
      for(const {file,box}of bounds) {
        let top=1,bottom=0,left=1,right=0;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) {
          const v=new THREE.Vector3(x,y,z).applyMatrix4(kart.matrixWorld).project(camera),sx=(v.x+1)/2,sy=(1-v.y)/2;
          top=Math.min(top,sy);bottom=Math.max(bottom,sy);left=Math.min(left,sx);right=Math.max(right,sx);
        }
        assert.ok(top>=.45&&bottom<=.83,`${file} clipped/too low at ${width}x${height}, distance=${distance}, speed=${speed}, offset=${offset}, yaw=${yaw}: ${top}..${bottom}`);
        assert.ok(right-left<.2&&left>.08&&right<.92,'The kart stays small enough to leave the central road visible');
      }
    }
  }
  assert.equal(chaseFraming(viewportProfile({width:1440,height:900}),28).relativeToPlayer,false,'Desktop camera path is unchanged');
  assert.equal(chaseFraming(viewportProfile({width:390,height:844,touch:true}),28).relativeToPlayer,false,'Portrait fallback keeps its existing path');
});
