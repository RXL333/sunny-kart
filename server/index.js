import http from 'node:http';
import { randomUUID, randomInt } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Race } from '../src/game/race.js';
import { track } from '../src/game/track.js';

const port = Number(process.env.PORT || 3001);
const rooms = new Map();
const clients = new Map();
const allowedCharacters = new Set(['fox', 'rabbit', 'panda']);
const allowedDifficulty = new Set(['easy', 'normal', 'hard']);
const cleanName = value => String(value || '晴空车手').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 16) || '晴空车手';
const send = (client, message) => {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(message));
};
const broadcast = (room, message) => { for (const client of room.members.values()) send(client, message); };
const roomState = room => ({
  type: 'room', code: room.code, hostId: room.hostId, status: room.status,
  players: [...room.members.values()].map(c => ({ id: c.id, name: c.name, character: c.character, connected: true })),
  difficulty: room.difficulty, laps: 3, maxPlayers: 8,
});

function leaveRoom(client) {
  const room = rooms.get(client.room);
  client.room = null;
  if (!room) return;
  room.members.delete(client.id);
  if (!room.members.size) { rooms.delete(room.code); return; }
  if (room.hostId === client.id) room.hostId = room.members.keys().next().value;
  if (room.race) {
    room.race.humanIds.delete(client.id);
    const racer = room.race.racers.find(r => r.id === client.id);
    if (racer) racer.name = `${racer.name} · AI`;
  }
  broadcast(room, roomState(room));
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
  return code;
}

function receive(client, message) {
  const data = JSON.parse(message);
  if (!data || typeof data !== 'object') return;
  if (data.type === 'ping') { send(client, { type: 'pong', time: data.time, serverTime: Date.now() }); return; }
  if (data.type === 'leave') { leaveRoom(client); send(client, { type: 'left' }); return; }
  if (data.type === 'create') {
    if (client.room) leaveRoom(client);
    client.name = cleanName(data.name); client.character = allowedCharacters.has(data.character) ? data.character : 'fox';
    const room = { code: newCode(), hostId: client.id, members: new Map([[client.id, client]]), status: 'lobby', difficulty: allowedDifficulty.has(data.difficulty) ? data.difficulty : 'normal', race: null, tick: 0 };
    rooms.set(room.code, room); client.room = room.code;
    send(client, roomState(room)); return;
  }
  if (data.type === 'join') {
    const code = String(data.room || data.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw new Error('没有找到这个房间，请检查房间码');
    if (room.status === 'racing') throw new Error('比赛已经开始，等待下一场');
    if (room.members.size >= 8 && !room.members.has(client.id)) throw new Error('房间已满，最多 8 人');
    if (client.room !== room.code) leaveRoom(client);
    client.name = cleanName(data.name); client.character = allowedCharacters.has(data.character) ? data.character : 'fox';
    room.members.set(client.id, client); client.room = room.code;
    broadcast(room, roomState(room)); return;
  }
  const room = rooms.get(client.room);
  if (!room) throw new Error('请先创建或加入房间');
  if (data.type === 'start') {
    if (client.id !== room.hostId) throw new Error('只有房主可以开始比赛');
    if (room.status === 'racing') throw new Error('比赛已经开始');
    if (room.members.size < 2) throw new Error('邀请一位朋友加入后即可开始比赛');
    room.race = new Race(track, {
      humanPlayers: [...room.members.values()].map(c => ({ id: c.id, name: c.name, character: c.character })),
      multiplayer: true, difficulty: room.difficulty, laps: 3,
    });
    room.tick = 0; room.status = 'racing'; room.race.start();
    for (const member of room.members.values()) { member.input = {}; member.inputAt = 0; member.seq = -1; }
    const state = room.race.snapshot();
    for (const member of room.members.values()) send(member, { type: 'started', playerId: member.id, state });
    broadcast(room, roomState(room)); return;
  }
  if (data.type === 'input') {
    if (!room.race || room.status !== 'racing') return;
    const seq = Number(data.seq);
    if (Number.isFinite(seq) && seq <= client.seq) return;
    if (Number.isFinite(seq)) client.seq = seq;
    const input = data.input || {};
    client.input = {
      throttle: Math.max(0, Math.min(1, Number(input.throttle) || 0)),
      brake: Math.max(0, Math.min(1, Number(input.brake) || 0)),
      steer: Math.max(-1, Math.min(1, Number(input.steer) || 0)),
      drift: Boolean(input.drift), nitro: Boolean(input.nitro),
    };
    client.inputAt = performance.now(); return;
  }
  throw new Error('不支持的房间操作');
}

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replaceAll('\\', '/'); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname === '/health') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, service: 'sunny-kart', tickRate: 60, snapshotRate: 20, rooms: rooms.size, clients: clients.size })); return;
  }
  let filename = path.resolve(distRoot, `.${pathname}`);
  const withinRoot = filename === path.resolve(distRoot) || filename.startsWith(path.resolve(distRoot) + path.sep);
  if (!withinRoot || pathname.includes('\0')) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    let info;
    try { info = await stat(filename); } catch { /* extensionless URLs use SPA fallback below. */ }
    if (info?.isDirectory()) { filename = path.join(filename, 'index.html'); info = await stat(filename); }
    if (!info && !path.extname(pathname)) { filename = path.join(distRoot, 'index.html'); info = await stat(filename); }
    if (!info?.isFile()) throw new Error('Not a file');
    const extension = path.extname(filename).toLowerCase();
    res.setHeader('Content-Type', mime[extension] || 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    res.setHeader('Cache-Control', extension === '.html' ? 'no-cache' : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    if (req.method === 'HEAD') res.end();
    else { const stream = createReadStream(filename); stream.on('error', () => res.destroy()); stream.pipe(res); }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(pathname === '/' ? '请先运行 npm run build 生成游戏资源，再使用 npm start。' : 'Not found');
  }
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });
wss.on('connection', ws => {
  const client = { id: randomUUID(), ws, name: '晴空车手', character: 'fox', room: null, input: {}, seq: -1, inputAt: 0, messages: 0, rateAt: performance.now() };
  clients.set(client.id, client);
  send(client, { type: 'welcome', id: client.id, serverTime: Date.now() });
  ws.on('message', bytes => {
    const now = performance.now();
    if (now - client.rateAt > 1000) { client.messages = 0; client.rateAt = now; }
    if (++client.messages > 120) { send(client, { type: 'error', message: '操作过于频繁，请稍后重试' }); return; }
    try { receive(client, bytes.toString()); }
    catch (error) { send(client, { type: 'error', message: error instanceof SyntaxError ? '消息格式错误' : error.message }); }
  });
  ws.on('close', () => { leaveRoom(client); clients.delete(client.id); });
  ws.on('error', () => { /* close event performs room cleanup. */ });
});

let previous = performance.now(), accumulator = 0;
const timer = setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(0.1, (now - previous) / 1000); previous = now;
  while (accumulator >= 1 / 60) {
    accumulator -= 1 / 60;
    for (const room of rooms.values()) {
      if (room.status !== 'racing' || !room.race) continue;
      const inputs = {};
      for (const member of room.members.values()) inputs[member.id] = now - member.inputAt < 450 ? member.input : {};
      room.race.update(1 / 60, {}, inputs); room.tick++;
      if (room.tick % 3 === 0 || room.race.phase === 'finished') broadcast(room, { type: 'snapshot', tick: room.tick, state: room.race.snapshot() });
      if (room.race.phase === 'finished') { room.status = 'finished'; broadcast(room, roomState(room)); }
    }
  }
}, 1000 / 60);
server.listen(port, '0.0.0.0', () => console.log(`Sunny Kart multiplayer listening on http://0.0.0.0:${server.address().port} (WebSocket /ws, 60 Hz / 20 Hz)`));
function shutdown() {
  clearInterval(timer);
  for (const client of clients.values()) client.ws.close(1001, 'Server shutting down');
  wss.close(); server.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
