import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

async function boot(t) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start')), 6000);
    let text = '';
    child.stdout.on('data', data => {
      text += data;
      const match = text.match(/listening on http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); if (code) reject(new Error(`Test server exited ${code}`)); });
  });
  return port;
}

async function connect(port, t) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?protocolVersion=4`);
  t.after(() => ws.close());
  const messages = [], pending = [];
  ws.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    const waiter = pending.find(w => w.match(message));
    if (waiter) { pending.splice(pending.indexOf(waiter), 1); clearTimeout(waiter.timeout); waiter.resolve(message); }
    else { messages.push(message); if (messages.length > 300) messages.shift(); }
  });
  const wait = (match, timeoutMs = 6000) => {
    const i = messages.findIndex(match);
    if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { match, resolve };
      w.timeout = setTimeout(() => { pending.splice(pending.indexOf(w), 1); reject(new Error('Expected server message timed out')); }, timeoutMs);
      pending.push(w);
    });
  };
  await once(ws, 'open');
  const welcome = await wait(m => m.type === 'welcome');
  return { ws, id: welcome.id, wait, send: data => ws.send(JSON.stringify({protocolVersion:4,...data})) };
}

test('two real WebSocket clients create/join/start, receive authoritative movement and transfer host', { timeout: 12000 }, async t => {
  const port = await boot(t);
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.tickRate, 60); assert.equal(health.snapshotRate, 20);
  const outside = await fetch(`http://127.0.0.1:${port}/%2e%2e%5cpackage.json`);
  assert.equal(outside.status, 403);
  const a = await connect(port, t), b = await connect(port, t);
  a.send({ type: 'create', name: '橙子', character: 'fox' });
  const room = await a.wait(m => m.type === 'room');
  assert.equal(room.code.length, 6); assert.equal(room.hostId, a.id);
  assert.equal(room.trackId, 'sunny-island', 'older clients without a selection use the original island');
  b.send({ type: 'join', room: room.code, name: '棉花', character: 'rabbit' });
  const joined = await b.wait(m => m.type === 'room' && m.players.length === 2);
  assert.equal(joined.players.length, 2);
  b.send({ type: 'start' });
  assert.match((await b.wait(m => m.type === 'error')).message, /房主/);
  a.send({ type: 'start' });
  const startedA = await a.wait(m => m.type === 'started');
  const startedB = await b.wait(m => m.type === 'started');
  assert.equal(startedA.playerId, a.id); assert.equal(startedB.playerId, b.id);
  assert.equal(startedA.state.racers.length, 8);
  let seq = 0;
  const drive = setInterval(() => {
    a.send({ type: 'input', seq: ++seq, input: { throttle: 1 } });
    b.send({ type: 'input', seq, input: { brake: 1 } });
  }, 40);
  t.after(() => clearInterval(drive));
  const early = await b.wait(m => m.type === 'snapshot' && m.state.phase === 'racing' && m.state.elapsed > 0 && m.state.elapsed < 0.2);
  assert.ok(early.state.racers.find(r => r.id === a.id).speed > 0);
  assert.equal(early.state.racers.find(r => r.id === b.id).speed, 0, 'Before traffic arrives, braking does not activate the second engine');
  const moving = await b.wait(m => m.type === 'snapshot' && m.state.phase === 'racing' && m.state.racers.find(r => r.id === a.id)?.speed > 16);
  assert.ok(moving.state.racers.find(r => r.id === a.id).distance > 0);
  const activeSpeed = moving.state.racers.find(r => r.id === a.id).speed;
  const brakingSpeed = moving.state.racers.find(r => r.id === b.id).speed;
  assert.ok(brakingSpeed < activeSpeed * 0.5 && activeSpeed - brakingSpeed > 8, 'Braking remains distinct from active throttle even when traffic pushes the stopped kart');
  assert.deepEqual(new Set(moving.state.humanIds), new Set([a.id, b.id]));
  clearInterval(drive);
  a.send({ type: 'leave' });
  const transferred = await b.wait(m => m.type === 'room' && m.hostId === b.id);
  assert.equal(transferred.players.length, 1);
  const afterLeave = await b.wait(m => m.type === 'snapshot' && m.state.humanIds.length === 1);
  assert.deepEqual(afterLeave.state.humanIds, [b.id]);
  b.send({ type: 'ping', time: 1234 });
  assert.equal((await b.wait(m => m.type === 'pong')).time, 1234);
});

test('every new course stays authoritative across room joins, start and snapshots', {timeout:16000}, async t => {
  const port=await boot(t),a=await connect(port,t),b=await connect(port,t);
  const health=await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.deepEqual(health.trackIds,['sunny-island','candy-hills','bay-loop','starlight-canyon']);
  a.send({type:'create',trackId:'unknown-map'});
  assert.match((await a.wait(m=>m.type==='error')).message,/赛道/);
  for(const trackId of health.trackIds.slice(1)){
    a.send({type:'create',trackId,character:'fox'});
    const room=await a.wait(m=>m.type==='room'&&m.status==='lobby'&&m.trackId===trackId);
    b.send({type:'join',room:room.code,character:'rabbit',trackId:'sunny-island',protocolVersion:3});
    assert.match((await b.wait(m=>m.type==='error')).message,/刷新游戏/,'stale clients cannot silently render the wrong circuit');
    b.send({type:'join',room:room.code,character:'rabbit',trackId:'sunny-island',protocolVersion:4});
    const joined=await b.wait(m=>m.type==='room'&&m.code===room.code);
    assert.equal(joined.trackId,trackId,'a guest cannot override the host course');
    a.send({type:'start'});
    const starts=await Promise.all([a.wait(m=>m.type==='started'),b.wait(m=>m.type==='started')]);
    for(const message of starts)assert.equal(message.state.trackId,trackId);
    const snapshot=await b.wait(m=>m.type==='snapshot'&&m.state.trackId===trackId);
    assert.equal(snapshot.state.racers.length,8);
    a.send({type:'leave'});await a.wait(m=>m.type==='left');
    const transferred=await b.wait(m=>m.type==='room'&&m.hostId===b.id&&m.trackId===trackId);
    assert.equal(transferred.trackId,trackId);
    b.send({type:'leave'});await b.wait(m=>m.type==='left');
    // Respect the production create cooldown instead of weakening it for this check.
    await new Promise(resolve=>setTimeout(resolve,1050));
  }
});
