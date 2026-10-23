import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../src/game/protocol.js';

async function boot(t) {
  const child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: '0', RESUME_GRACE_MS: '4000' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Party server startup timeout')), 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', bytes => {
      const match = String(bytes).match(/0\.0\.0\.0:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
}

function peer(t, port, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?protocolVersion=${PROTOCOL_VERSION}${token ? `&resume=${encodeURIComponent(token)}` : ''}`);
  const messages = [], all = [], waiters = [];
  t.after(() => ws.terminate()); ws.on('error', () => {});
  ws.on('message', bytes => {
    const message = JSON.parse(bytes); all.push(message);
    const index = waiters.findIndex(waiter => waiter.predicate(message));
    if (index < 0) { messages.push(message); return; }
    const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message);
  });
  return {
    ws, all,
    send: message => ws.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...message })),
    wait(predicate) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiter.timer = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Party message timeout')); }, 5000);
        waiters.push(waiter);
      });
    },
  };
}

test('party configuration, vote recovery, host-only start and round guards work over real sockets', { timeout: 15000 }, async t => {
  const port = await boot(t), host = peer(t, port), guest = peer(t, port);
  const [hostIdentity, guestIdentity] = await Promise.all([host, guest].map(client => client.wait(m => m.type === 'welcome')));
  host.send({ type: 'create', mode: 'items' });
  const created = await host.wait(m => m.type === 'room');
  guest.send({ type: 'join', room: created.code });
  await guest.wait(m => m.type === 'room' && m.players.length === 2);

  for (const command of [{ type: 'configure', laps: 1 }, { type: 'returnToLobby' }, { type: 'start', roundId: 0 }]) {
    guest.send(command);
    assert.match((await guest.wait(m => m.type === 'error')).message, /房主/);
  }
  host.send({ type: 'configure', trackId: 'candy-hills', mode: 'items', difficulty: 'easy', laps: 1 });
  const configured = await guest.wait(m => m.type === 'room' && m.trackId === 'candy-hills');
  assert.equal(configured.laps, 1); assert.equal(configured.difficulty, 'easy');
  host.send({ type: 'configure', trackId: 'bay-loop', laps: 2 });
  assert.match((await host.wait(m => m.type === 'error')).message, /圈数/);

  host.send({ type: 'voteTrack', trackId: 'bay-loop' });
  await host.wait(m => m.type === 'room' && m.trackVotes[hostIdentity.id] === 'bay-loop');
  guest.send({ type: 'voteTrack', trackId: 'starlight-canyon' });
  await guest.wait(m => m.type === 'room' && m.trackVotes[guestIdentity.id] === 'starlight-canyon');
  guest.send({ type: 'voteTrack', trackId: 'starlight-canyon' });
  const tied = await guest.wait(m => m.type === 'room' && m.trackVotes[guestIdentity.id] === 'starlight-canyon');
  assert.equal(tied.trackVoteCounts['starlight-canyon'], 1);
  assert.equal(tied.nextTrackId, 'bay-loop'); assert.equal(tied.trackId, 'candy-hills', 'an invalid configure cannot partially change the room');
  guest.send({ type: 'voteTrack', trackId: 'bay-loop' });
  await guest.wait(m => m.type === 'room' && m.trackVoteCounts['bay-loop'] === 2);
  const closed = once(guest.ws, 'close'); guest.ws.terminate(); await closed;
  await host.wait(m => m.type === 'room' && m.players.some(p => p.id === guestIdentity.id && !p.connected));
  const returning = peer(t, port, guestIdentity.resumeToken);
  const resumed = await returning.wait(m => m.type === 'welcome');
  assert.equal(resumed.id, guestIdentity.id); assert.equal(resumed.resumed, true);
  const restored = await returning.wait(m => m.type === 'room');
  assert.equal(restored.trackVoteCounts['bay-loop'], 2);
  returning.send({ type: 'voteTrack', trackId: 'bay-loop' });
  assert.equal((await returning.wait(m => m.type === 'room')).trackVoteCounts['bay-loop'], 2, 'restoring a seat cannot gain a second vote');

  host.send({ type: 'start', roundId: 0 });
  const [a, b] = await Promise.all([host, returning].map(client => client.wait(m => m.type === 'started')));
  assert.equal(a.roomCode, created.code); assert.equal(a.roundId, 1);
  assert.equal(a.state.trackId, 'bay-loop'); assert.equal(a.state.laps, 1);
  assert.equal(b.state.trackId, a.state.trackId); assert.equal(b.state.events[0].eventId, a.state.events[0].eventId);
  assert.match(a.state.events[0].eventId, new RegExp(`^${created.code}:1:`));
  const racing = await host.wait(m => m.type === 'room' && m.status === 'racing');
  assert.deepEqual(racing.trackVotes, {});
  host.send({ type: 'start', roundId: 0 }); host.send({ type: 'start', roundId: 1 });
  host.send({ type: 'ping', time: 88 }); await host.wait(m => m.type === 'pong' && m.time === 88);
  assert.equal(host.all.filter(m => m.type === 'started').length, 1, 'double clicking start cannot reset the active race');
  host.send({ type: 'input', roundId: 0, seq: 999, input: { throttle: 1 } });
  host.send({ type: 'input', roundId: 1, seq: 1, input: { brake: 1 } });
  const ack = await host.wait(m => m.type === 'snapshot' && m.inputAcks[hostIdentity.id] === 1);
  assert.equal(ack.roundId, 1, 'a stale high sequence cannot block the new round input stream');
  for (const command of [{ type: 'configure', laps: 3 }, { type: 'returnToLobby' }, { type: 'voteTrack', trackId: 'sunny-island' }]) {
    host.send(command);
    assert.match((await host.wait(m => m.type === 'error')).message, /比赛/);
  }
  const nextEvent = await host.wait(m => m.type === 'snapshot' && m.state.events.length);
  assert.notEqual(nextEvent.state.events[0].eventId, a.state.events[0].eventId);
  const eventIds = host.all.filter(m => m.type === 'started' || m.type === 'snapshot').flatMap(m => m.state.events.map(e => e.eventId));
  assert.equal(new Set(eventIds).size, eventIds.length, 'authority events are assigned once across snapshots');
});
