import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';

const endpoint=new URL(process.argv[2]||'https://sunny-kart-server.onrender.com');
const trackId=process.argv[3]||'sunny-island';
const health=await fetch(new URL('/health',endpoint),{signal:AbortSignal.timeout(90000)});
assert.equal(health.status,200);
const service=await health.json();assert.equal(service.service,'sunny-kart');
assert.ok(service.trackIds?.includes(trackId),'The deployed backend supports the selected course');
const sockets=[];let driving;
async function client() {
  const target=new URL('/ws',endpoint);target.protocol=endpoint.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(target);sockets.push(ws);
  const queue=[],pending=[];
  const fail=error=>{for(const p of pending.splice(0)){clearTimeout(p.timer);p.reject(error);}};
  ws.on('error',fail);
  ws.on('close',()=>fail(new Error('Public WebSocket closed before the expected message')));
  ws.on('message',bytes=>{
    const m=JSON.parse(bytes);const i=pending.findIndex(p=>p.match(m));
    if(i>=0){const p=pending.splice(i,1)[0];clearTimeout(p.timer);p.resolve(m);}
    else {queue.push(m);if(queue.length>300)queue.shift();}
  });
  const wait=(match,timeout=15000)=>{
    const i=queue.findIndex(match);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);
    return new Promise((resolve,reject)=>{
      const p={match,resolve,reject};p.timer=setTimeout(()=>{pending.splice(pending.indexOf(p),1);reject(new Error('Public server message timed out'));},timeout);pending.push(p);
    });
  };
  const id=(await wait(m=>m.type==='welcome')).id;
  return {id,wait,send:m=>ws.send(JSON.stringify(m))};
}
try {
  const a=await client(),b=await client();
  a.send({type:'create',name:'QA 阳光',character:'fox',trackId});
  const room=await a.wait(m=>m.type==='room');assert.equal(room.hostId,a.id);assert.equal(room.trackId,trackId);
  b.send({type:'join',room:room.code,name:'QA 海风',character:'rabbit',protocolVersion:3});
  await a.wait(m=>m.type==='room'&&m.players.length===2);
  await b.wait(m=>m.type==='room'&&m.players.length===2);
  a.send({type:'start'});
  const [sa,sb]=await Promise.all([a.wait(m=>m.type==='started'),b.wait(m=>m.type==='started')]);
  assert.equal(sa.playerId,a.id);assert.equal(sb.playerId,b.id);assert.equal(sa.state.racers.length,8);
  assert.equal(sa.state.trackId,trackId);assert.equal(sb.state.trackId,trackId);
  let seq=0;driving=setInterval(()=>{a.send({type:'input',seq:++seq,input:{throttle:1}});b.send({type:'input',seq,input:{brake:1}});},40);
  const moving=await b.wait(m=>m.type==='snapshot'&&m.state.phase==='racing'&&m.state.racers.find(r=>r.id===a.id)?.speed>16);
  const active=moving.state.racers.find(r=>r.id===a.id),braking=moving.state.racers.find(r=>r.id===b.id);
  assert.ok(active.distance>0);assert.ok(active.speed-braking.speed>8);
  clearInterval(driving);
  const rtts=[];
  for(let i=0;i<5;i++){const time=performance.now();a.send({type:'ping',time});await a.wait(m=>m.type==='pong'&&m.time===time);rtts.push(Math.round(performance.now()-time));}
  a.send({type:'leave'});await b.wait(m=>m.type==='room'&&m.hostId===b.id&&m.players.length===1);
  b.send({type:'leave'});
  console.log(JSON.stringify({ok:true,endpoint:endpoint.origin,trackId,checks:['health','two WSS clients','selected course create/join','host start','authoritative movement','independent braking','host transfer'],rttMs:rtts},null,2));
} finally {
  clearInterval(driving);for(const ws of sockets)ws.close();
}
