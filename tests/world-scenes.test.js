import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { World } from '../src/world.js';
import { createTrack, TRACK_CATALOG } from '../src/game/track.js';
import { Race } from '../src/game/race.js';

test('all four procedural scenes construct finite geometry, update the camera and release their resources on map changes', t=>{
  const window=new Window({url:'http://localhost/'}),document=window.document;
  const replacements={window,document,navigator:window.navigator,innerWidth:844,innerHeight:390,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}};
  const originals=new Map();
  for(const [key,value] of Object.entries(replacements)){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
  // Canvas is used for sign textures only; no browser or GPU rendering is claimed by this test.
  window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},fillText(){}});
  t.after(()=>{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}window.close();});
  const backgrounds=new Set();
  for(const course of TRACK_CATALOG){
    const canvas=document.createElement('canvas');canvas.getBoundingClientRect=()=>({width:844,height:390});document.body.append(canvas);
    const renderer={domElement:canvas,shadowMap:{},setPixelRatio(){},setSize(){},renders:0,render(){this.renders++;},renderLists:{dispose(){}},dispose(){this.disposed=true;}};
    const track=createTrack(course.id),world=new World(canvas,track,{createRenderer:()=>renderer}),race=new Race(track);
    assert.equal(world.themeId,course.id);backgrounds.add(world.scene.background.getHex());
    const geometries=new Set();let vertices=0;
    world.scene.traverse(object=>{
      assert.ok(object.position.toArray().every(Number.isFinite));
      if(!object.geometry||geometries.has(object.geometry))return;
      geometries.add(object.geometry);const position=object.geometry.getAttribute('position');
      assert.ok(position.array.every(Number.isFinite),`${course.id} has finite scene geometry`);vertices+=position.count;
      if(object.isInstancedMesh)assert.ok(object.instanceMatrix.array.every(Number.isFinite));
    });
    assert.ok(vertices>10000);assert.ok(world.crystals.length>=90);
    world.update(1/60,race,true);world.overview=true;world.update(1/60,race,true);world.update(1/60,race,false);
    assert.equal(renderer.renders,3);assert.ok(world.camera.position.toArray().every(Number.isFinite));
    let disposed=0;for(const geometry of geometries)geometry.addEventListener('dispose',()=>{disposed++;});
    world.dispose();assert.equal(renderer.disposed,true);assert.equal(disposed,geometries.size);assert.equal(world.scene.children.length,0);
    world.dispose();world.update(1/60,race);assert.equal(renderer.renders,3);canvas.remove();
  }
  assert.equal(backgrounds.size,4,'each destination has its own environment palette');
});
