import test from 'node:test';
import assert from 'node:assert/strict';
import { Minimap } from '../src/minimap.js';

test('minimap caches the route, throttles markers and refreshes after a course switch', () => {
  let routes = 0, frames = 0, samples = 0;
  const context = {beginPath(){},moveTo(){routes++;},lineTo(){},closePath(){},stroke(){},arc(){},fill(){},clearRect(){frames++;},drawImage(){}};
  const canvas = {width:192,height:152,getContext:()=>context};
  const map = new Minimap(canvas,{createCanvas:()=>({...canvas})});
  const track = {points:[{x:0,z:0},{x:10,z:10}],sample:()=>{samples++;return {x:1,z:1};}};
  const race = {racers:[{id:'p',distance:1},{id:'ai',distance:2}],player:{id:'p',distance:1}};
  map.update(track,race,0);map.update(track,race,16);map.update(track,race,100);
  assert.equal(routes,1);assert.equal(frames,2);assert.equal(samples,4);
  map.update({...track},race,110);assert.equal(routes,2);assert.equal(frames,3);
});
