import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Window } from 'happy-dom';
import { World } from '../src/world.js';
import { Race } from '../src/game/race.js';
import { createTrack } from '../src/game/track.js';
import { ModelCache } from '../src/model-cache.js';

function setup(t,modelCache){
  const window=new Window({url:'http://localhost/'}),document=window.document;
  const replacements={window,document,navigator:window.navigator,innerWidth:844,innerHeight:390,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}};
  const originals=new Map();
  for(const [key,value]of Object.entries(replacements)){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
  window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},fillText(){}});
  t.after(()=>{world.dispose();for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}window.close();});
  const track=createTrack('candy-hills'),canvas=document.createElement('canvas');canvas.getBoundingClientRect=()=>({width:844,height:390});
  const renderer={domElement:canvas,shadowMap:{},setPixelRatio(){},setSize(){},render(){},renderLists:{dispose(){}},dispose(){}};
  const world=new World(canvas,track,{createRenderer:()=>renderer,modelCache}),race=new Race(track,{mode:'items'});
  return{world,race,track};
}

test('nitro and item pickups disappear on authority, animate once, and return next lap',t=>{
  const {world,race,track}=setup(t);race.phase='racing';
  world.update(1/60,race);const crystal=world.crystals[0],id=crystal.item.id;
  assert.equal(crystal.mesh.visible,true);
  race.player.collectedLaps[id]=0;race.player.collected[id]=1;race.elapsed=1;
  world.update(1/60,race);assert.equal(crystal.mesh.visible,false);assert.ok(world.particles.length>=12);
  const particles=world.particles.length;
  // Server snapshots replace player objects and can pull elapsed back slightly.
  const copy={...race.player,collectedLaps:{...race.player.collectedLaps}};race.racers[0]=copy;race.player=copy;race.elapsed=.99;
  world.update(1/60,race);assert.equal(world.particles.length,particles,'confirmed pickup must not animate twice');
  const box=world.itemVisuals[0];assert.ok(box);race.player.itemCollected[box.item.id]=0;
  world.update(1/60,race);assert.equal(box.mesh.visible,false);
  race.player.distance=track.length+1;race.player.bestDistance=track.length+1;
  world.update(1/60,race);assert.equal(crystal.mesh.visible,true);assert.equal(box.mesh.visible,true);
  race.player.collectedLaps[id]=1;world.update(1/60,race);assert.equal(crystal.mesh.visible,false);
  race.reset();race.start();world.update(1/60,race);assert.equal(crystal.mesh.visible,true);assert.equal(world.particles.length,0,'restart clears the previous pickup trail');
});

test('particle pool reuses geometry/materials and ghost never enters race simulation',t=>{
  const {world,race}=setup(t);const position=new THREE.Vector3(),direction={tx:1,tz:0};
  for(let i=0;i<20;i++)world.spark(position,0xff9900,direction,false);
  const meshes=new Set(world.particles.map(p=>p.mesh)),geometry=world.particleGeometry;
  world.update(1,race,true);assert.equal(world.particles.length,0);assert.equal(world.particlePool.length,20);
  for(let i=0;i<20;i++)world.spark(position,0x99ffff,direction,false);
  assert.equal(world.particleGeometry,geometry);assert.ok(world.particles.every(p=>meshes.has(p.mesh)));assert.equal(world.particlePool.length,0);
  const count=race.racers.length;world.updateGhost({distance:150,offset:2,yaw:.1});
  assert.equal(world.ghost.visible,true);assert.equal(race.racers.length,count);
  world.ghost.traverse(o=>{if(o.isMesh){assert.ok(o.material.opacity<1);assert.equal(o.material.depthWrite,false);}});
  world.updateGhost(null);assert.equal(world.ghost.visible,false);
});

test('progressive kart loading is playable before assets arrive and cached models survive scene disposal',async t=>{
  const model=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial({color:0xffffff});material.name='KartPaint';model.add(new THREE.Mesh(geometry,material));
  let resolve;const cache=new ModelCache(()=>new Promise(done=>resolve=done));
  const {world,race}=setup(t,cache);let geometryDisposed=0,materialDisposed=0;
  geometry.addEventListener('dispose',()=>geometryDisposed++);material.addEventListener('dispose',()=>materialDisposed++);
  await world.createKarts({progressive:true});assert.equal(world.karts.length,8);assert.equal(world.assetLoaded,undefined);
  world.setLineup(race.racers);world.update(1/60,race,true);
  resolve({models:{fox:model,rabbit:model,panda:model},resources:{geometries:new Set([geometry]),materials:new Set([material]),textures:new Set()}});
  await world.ready;assert.equal(world.assetLoaded,true);assert.equal(world.karts[0].character,'fox');
  world.dispose();assert.equal(geometryDisposed,0);assert.equal(materialDisposed,0,'shared cache materials stay valid for the next scene');
  assert.equal(cache.loads,1);
});


test('single-driver lineups hide unused cars and restore them for a full race',async t=>{
  const model=new THREE.Group(),cache=new ModelCache(()=>({models:{fox:model,rabbit:model,panda:model},resources:{}}));
  const {world,race}=setup(t,cache);await world.createKarts({progressive:true});
  const full=race.racers;world.setLineup([race.player]);
  assert.equal(world.karts.filter(k=>k.root.visible).length,1);
  world.update(1/60,{...race,racers:[race.player]},true);
  assert.equal(world.karts.filter(k=>k.root.visible).length,1);
  world.setLineup(full);assert.equal(world.karts.filter(k=>k.root.visible).length,8);
  await world.ready;
});

test('item objects render only in item races and reuse bounded scene resources', t=>{
  const {world,race}=setup(t);race.phase='racing';
  race.itemObjects=[{id:'bubble-1',type:'bubble',ownerId:race.player.id,distance:20,offset:1,life:2},{id:'jelly-1',type:'jelly',ownerId:'ai-0',distance:40,offset:-1,life:5}];
  world.update(1/60,race);
  const active=world.itemObjectView.pool.filter(entry=>entry.used);
  assert.equal(active.length,2);assert.equal(world.itemObjectView.pool.length,48);
  const first=active.find(entry=>entry.id==='bubble-1').root;
  assert.equal(first.visible,true);
  race.itemObjects[0].distance+=10;world.update(1/60,race);
  assert.equal(world.itemObjectView.pool.find(entry=>entry.id==='bubble-1').root,first,'movement does not allocate a new visual');
  race.itemObjects=[];world.update(1/60,race);assert.ok(world.itemObjectView.pool.every(entry=>!entry.root.visible));
  race.itemObjects=[{id:'jelly-2',type:'jelly',ownerId:'ai-1',distance:10,offset:0,life:4}];race.mode='race';world.update(1/60,race);
  assert.ok(world.itemObjectView.pool.every(entry=>!entry.root.visible),'switching mode leaves no traps');
});
