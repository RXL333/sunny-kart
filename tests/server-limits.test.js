import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

test('public backend limits clients and rooms, throttles creation and reclaims idle and half-open sessions',{timeout:10000},async t=>{
  const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',MAX_CLIENTS:'3',MAX_ROOMS:'1',CREATE_ROOM_COOLDOWN_MS:'2000',HEARTBEAT_INTERVAL_MS:'1000',LOBBY_IDLE_MS:'1000'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timeout')),4000);child.once('error',reject);child.stdout.on('data',bytes=>{const match=String(bytes).match(/0\.0\.0\.0:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});});
  function peer(autoPong=true){
    const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,{autoPong}),messages=[],waiters=[];
    t.after(()=>ws.terminate());
    ws.on('message',bytes=>{const message=JSON.parse(bytes),waiter=waiters.find(w=>w.predicate(message));if(waiter){waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(message);}else messages.push(message);});
    const wait=predicate=>{const i=messages.findIndex(predicate);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const waiter={predicate,resolve,timer:setTimeout(()=>reject(new Error('Expected message missing')),4000)};waiters.push(waiter);});};
    return {ws,wait,send:message=>ws.send(JSON.stringify(message))};
  }
  const a=peer(),b=peer(),zombie=peer(false);
  await Promise.all([a,b,zombie].map(p=>p.wait(m=>m.type==='welcome')));
  a.send({type:'create'});const room=await a.wait(m=>m.type==='room');
  a.send({type:'create'});assert.match((await a.wait(m=>m.type==='error')).message,/频繁/);
  b.send({type:'create'});assert.match((await b.wait(m=>m.type==='error')).message,/房间较多/);
  b.send({type:'join',room:room.code});await b.wait(m=>m.type==='room');
  const rejected=peer(),rejectedClose=once(rejected.ws,'close');
  assert.match((await rejected.wait(m=>m.type==='error')).message,/在线人数/);
  assert.equal((await rejectedClose)[0],1013);
  const aClosed=once(a.ws,'close'),bClosed=once(b.ws,'close'),zombieClosed=once(zombie.ws,'close');
  const [closedA,closedB,closedZombie]=await Promise.all([aClosed,bClosed,zombieClosed]);
  assert.equal(closedA[0],1000);assert.equal(closedB[0],1000);assert.equal(closedZombie[0],1006);
  const health=await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.rooms,0);assert.equal(health.clients,0);
});
