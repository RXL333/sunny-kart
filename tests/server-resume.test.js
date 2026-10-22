import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';

async function boot(t,grace='2000'){
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',RESUME_GRACE_MS:grace},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
 return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),4000);child.on('error',reject);child.stdout.on('data',bytes=>{const m=String(bytes).match(/0\.0\.0\.0:(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});});
}
function peer(t,port,token,protocol=4){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/ws?protocolVersion=${protocol}${token?'&resume='+encodeURIComponent(token):''}`),messages=[],waiters=[];t.after(()=>ws.terminate());
 ws.on('error',()=>{});ws.on('message',bytes=>{const m=JSON.parse(bytes);const i=waiters.findIndex(w=>w.match(m));if(i>=0){const [w]=waiters.splice(i,1);clearTimeout(w.timer);w.resolve(m);}else messages.push(m);});
 return {ws,send:m=>ws.send(JSON.stringify({protocolVersion:4,...m})),wait(match){const i=messages.findIndex(match);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={match,resolve};w.timer=setTimeout(()=>reject(new Error('message timeout')),5000);waiters.push(w);});}};
}

test('reconnect resumes original racing vehicle, confirms inputs, rejects duplicate connection, explicit leave releases seat',{timeout:15000},async t=>{
 const port=await boot(t),a=peer(t,port),b=peer(t,port);
 const [wa,wb]=await Promise.all([a.wait(m=>m.type==='welcome'),b.wait(m=>m.type==='welcome')]);assert.ok(wa.resumeToken);
 a.send({type:'create'});const room=await a.wait(m=>m.type==='room');b.send({type:'join',room:room.code});await b.wait(m=>m.type==='room');
 a.send({type:'start'});await Promise.all([a.wait(m=>m.type==='started'),b.wait(m=>m.type==='started')]);
 a.send({type:'input',seq:42,input:{throttle:1}});const acknowledged=await a.wait(m=>m.type==='snapshot'&&m.inputAcks[wa.id]===42);assert.ok(acknowledged.serverTime>0);
 const duplicate=peer(t,port,wa.resumeToken);assert.equal((await duplicate.wait(m=>m.type==='resumeRejected')).type,'resumeRejected');
 const closed=once(a.ws,'close');a.ws.terminate();await closed;
 const transfer=await b.wait(m=>m.type==='room'&&m.hostId===wb.id);assert.equal(transfer.players.find(p=>p.id===wa.id).connected,false);
 const resumed=peer(t,port,wa.resumeToken);const welcome=await resumed.wait(m=>m.type==='welcome');assert.equal(welcome.id,wa.id);assert.equal(welcome.resumed,true);assert.equal(welcome.lastSeq,42);
 const started=await resumed.wait(m=>m.type==='started');assert.equal(started.playerId,wa.id);assert.ok(started.state.racers.some(r=>r.id===wa.id));
 resumed.send({type:'leave'});await resumed.wait(m=>m.type==='left');const departed=await b.wait(m=>m.type==='room'&&m.players.length===1);assert.equal(departed.players[0].id,wb.id);
 const invalid=peer(t,port,wa.resumeToken);await invalid.wait(m=>m.type==='resumeRejected');
});

test('expired recovery token cannot restore a reserved room',{timeout:10000},async t=>{
 const port=await boot(t,'100'),a=peer(t,port);const welcome=await a.wait(m=>m.type==='welcome');a.send({type:'create'});await a.wait(m=>m.type==='room');const closed=once(a.ws,'close');a.ws.terminate();await closed;
 // Poll a state transition instead of assuming cleanup has already run.
 const deadline=Date.now()+3000;let health;do{health=await(await fetch(`http://127.0.0.1:${port}/health`)).json();if(!health.rooms)break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<deadline);
 assert.equal(health.rooms,0);const expired=peer(t,port,welcome.resumeToken);await expired.wait(m=>m.type==='resumeRejected');
});

test('host transfer prefers online seats and the first returning player can host after a full outage',{timeout:10000},async t=>{
 const port=await boot(t),a=peer(t,port),b=peer(t,port),c=peer(t,port);
 const [wa,wb,wc]=await Promise.all([a,b,c].map(p=>p.wait(m=>m.type==='welcome')));
 a.send({type:'create'});const room=await a.wait(m=>m.type==='room');
 for(const p of [b,c]){p.send({type:'join',room:room.code});await p.wait(m=>m.type==='room');}
 const closedB=once(b.ws,'close');b.ws.terminate();await closedB;await a.wait(m=>m.type==='room'&&m.players.some(p=>p.id===wb.id&&!p.connected));
 a.send({type:'leave'});await a.wait(m=>m.type==='left');assert.equal((await c.wait(m=>m.type==='room'&&m.players.length===2)).hostId,wc.id);
 const closedC=once(c.ws,'close');c.ws.terminate();await closedC;
 const returning=peer(t,port,wb.resumeToken);await returning.wait(m=>m.type==='welcome');assert.equal((await returning.wait(m=>m.type==='room')).hostId,wb.id);
});

test('version gates protect new rooms, joining, starting and reserved-seat recovery',{timeout:10000},async t=>{
 const port=await boot(t),old=peer(t,port,undefined,3);
 const mismatch=await old.wait(m=>m.type==='protocolMismatch');assert.equal(mismatch.protocolVersion,4);assert.match(mismatch.message,/刷新游戏/);
 const health=await(await fetch(`http://127.0.0.1:${port}/health`)).json();assert.equal(health.clients,0);assert.deepEqual(health.modes,['race','items']);assert.ok(health.capabilities.includes('manual-items'));
 const a=peer(t,port),b=peer(t,port);const wa=await a.wait(m=>m.type==='welcome');await b.wait(m=>m.type==='welcome');
 a.send({type:'create',mode:'items',protocolVersion:3});assert.match((await a.wait(m=>m.type==='error')).message,/版本正在更新/);
 a.send({type:'create',mode:'time-trial'});assert.match((await a.wait(m=>m.type==='error')).message,/仅支持单人/);
 a.send({type:'create',mode:'items'});const room=await a.wait(m=>m.type==='room');assert.equal(room.mode,'items');
 b.send({type:'join',room:room.code,protocolVersion:3});assert.match((await b.wait(m=>m.type==='error')).message,/版本正在更新/);
 b.send({type:'join',room:room.code});assert.equal((await b.wait(m=>m.type==='room')).mode,'items');
 a.send({type:'start',protocolVersion:3});assert.match((await a.wait(m=>m.type==='error')).message,/版本正在更新/);
 a.send({type:'start'});const started=await a.wait(m=>m.type==='started');assert.equal(started.state.mode,'items');assert.equal(started.protocolVersion,4);assert.equal(started.mode,'items');
 const snapshot=await b.wait(m=>m.type==='snapshot');assert.equal(snapshot.state.mode,'items');assert.equal(snapshot.mode,'items');assert.ok(Array.isArray(snapshot.state.itemObjects));
 const closed=once(a.ws,'close');a.ws.terminate();await closed;
 const badResume=peer(t,port,wa.resumeToken,3);await badResume.wait(m=>m.type==='protocolMismatch');
 const resumed=peer(t,port,wa.resumeToken);assert.equal((await resumed.wait(m=>m.type==='welcome')).id,wa.id);assert.equal((await resumed.wait(m=>m.type==='room')).mode,'items');assert.equal((await resumed.wait(m=>m.type==='started')).state.mode,'items');
});

test('item action sequence is sanitized, consumed once and restored without a fresh action',{timeout:12000},async t=>{
 const port=await boot(t),a=peer(t,port),b=peer(t,port);const wa=await a.wait(m=>m.type==='welcome');await b.wait(m=>m.type==='welcome');
 a.send({type:'create',mode:'items'});const room=await a.wait(m=>m.type==='room');b.send({type:'join',room:room.code});await b.wait(m=>m.type==='room');a.send({type:'start'});await a.wait(m=>m.type==='started');
 await a.wait(m=>m.type==='snapshot'&&m.state.phase==='racing');
 a.send({type:'input',seq:1,input:{useItem:false,itemUseSeq:9,nitro:false}});
 const consumed=await a.wait(m=>m.type==='snapshot'&&m.state.phase==='racing'&&m.state.racers.find(r=>r.id===wa.id)?.lastItemUseSeq===9);
 assert.equal(consumed.state.racers.find(r=>r.id===wa.id).inventory,null);
 a.send({type:'input',seq:2,input:{useItem:true,itemUseSeq:-1}});
 const stillSame=await a.wait(m=>m.type==='snapshot'&&m.inputAcks[wa.id]===2);assert.equal(stillSame.state.racers.find(r=>r.id===wa.id).lastItemUseSeq,9);
 const closed=once(a.ws,'close');a.ws.terminate();await closed;const resumed=peer(t,port,wa.resumeToken);const welcome=await resumed.wait(m=>m.type==='welcome');assert.equal(welcome.lastItemUseSeq,9);
 const restored=await resumed.wait(m=>m.type==='started');assert.equal(restored.lastItemUseSeq,9);assert.equal(restored.state.racers.find(r=>r.id===wa.id).lastItemUseSeq,9);
 resumed.send({type:'input',seq:3,input:{useItem:true,itemUseSeq:9}});
 assert.equal((await resumed.wait(m=>m.type==='snapshot'&&m.inputAcks[wa.id]===3)).state.racers.find(r=>r.id===wa.id).lastItemUseSeq,9);
});
