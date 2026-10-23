import http from 'node:http';
import { randomUUID, randomInt } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Race } from '../src/game/race.js';
import { track, createTrack, TRACK_CATALOG, DEFAULT_TRACK_ID } from '../src/game/track.js';
import { PROTOCOL_VERSION, MULTIPLAYER_MODES, NETWORK_CAPABILITIES, UPDATE_MESSAGE, isRaceMode } from '../src/game/protocol.js';
import { configureRoom, voteForTrack, trackVoteSummary, returnRoomToLobby } from './party-room.js';

const port = Number(process.env.PORT || 3001);
const setting=(name,fallback,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(process.env[name]))?Number(process.env[name]):fallback));
const MAX_CLIENTS=setting('MAX_CLIENTS',32,1,512),MAX_ROOMS=setting('MAX_ROOMS',8,1,64);
const CREATE_COOLDOWN=setting('CREATE_ROOM_COOLDOWN_MS',1000,0,60000);
const HEARTBEAT_INTERVAL=setting('HEARTBEAT_INTERVAL_MS',30000,1000,120000),LOBBY_IDLE=setting('LOBBY_IDLE_MS',900000,1000,86400000);
const RESUME_GRACE=setting('RESUME_GRACE_MS',30000,100,120000);
const rooms = new Map();
const sessions = new Map();
const clients = new Map();
const trackCache = new Map([[DEFAULT_TRACK_ID, track]]);
const trackIds = new Set(TRACK_CATALOG.map(course => course.id));
function roomTrack(id) { if (!trackCache.has(id)) trackCache.set(id, createTrack(id)); return trackCache.get(id); }
const allowedCharacters = new Set(['fox', 'rabbit', 'panda']);
const allowedDifficulty = new Set(['easy', 'normal', 'hard']);
const cleanName = value => String(value || '晴空车手').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 16) || '晴空车手';
const send = (client, message) => {
  if(client.ws.bufferedAmount>1048576){client.ws.close(1013,'Connection too slow');return;}
  if(message.type==='snapshot'&&client.ws.bufferedAmount>262144)return;
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(message));
};
const broadcast = (room, message) => { for (const client of room.members.values()) send(client, message); };
const protocolInfo={protocolVersion:PROTOCOL_VERSION,modes:MULTIPLAYER_MODES,capabilities:NETWORK_CAPABILITIES};
const withEventIds = (room, state) => ({ ...state, mode: room.mode, events: (state.events || []).map(event => ({ ...event, eventId: `${room.code}:${room.roundId}:${++room.eventSeq}` })) });
const snapshotMessage=(room,state=room.race.snapshot())=>({type:'snapshot',...protocolInfo,mode:room.mode,roomCode:room.code,roundId:room.roundId,tick:room.tick,serverTime:performance.now(),inputAcks:Object.fromEntries([...room.members.values()].map(c=>[c.id,c.seq])),state:withEventIds(room,state)});
const roomState = room => ({
  type: 'room', code: room.code, hostId: room.hostId, status: room.status,
  players: [...room.members.values()].map(c => ({ id: c.id, name: c.name, character: c.character, connected: c.ws.readyState === WebSocket.OPEN })),
  difficulty: room.difficulty, trackId: room.trackId, mode:room.mode, ...protocolInfo, laps: room.laps, maxPlayers: 8,
  roundId: room.roundId, trackVotes: Object.fromEntries(room.trackVotes), ...trackVoteSummary(room, [...trackIds]),
});

function leaveRoom(client) {
  const room = rooms.get(client.room);
  client.room = null;
  clearTimeout(client.expiryTimer);
  if(client.ws.readyState!==WebSocket.OPEN)sessions.delete(client.resumeToken);
  room?.race?.disconnectedIds?.delete(client.id);
  if (!room) return;
  room.members.delete(client.id);
  room.trackVotes.delete(client.id);
  if (!room.members.size) { rooms.delete(room.code); return; }
  if (room.hostId === client.id) room.hostId = [...room.members.values()].find(member=>member.ws.readyState===WebSocket.OPEN)?.id ?? room.members.keys().next().value;
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
  if (['create','join','start','input','configure','voteTrack','returnToLobby'].includes(data.type) && (data.protocolVersion!==PROTOCOL_VERSION||client.protocolVersion!==PROTOCOL_VERSION))throw new Error(UPDATE_MESSAGE);
  if (data.type === 'create') {
    const trackId = data.trackId ?? DEFAULT_TRACK_ID;
    if (!trackIds.has(trackId)) throw new Error('没有找到这条赛道，请重新选择');
    const mode=data.mode??'race';
    if(!isRaceMode(mode))throw new Error('请选择竞速赛或道具赛，计时挑战仅支持单人游玩');
    const now=performance.now();
    if(now-client.lastCreateAt<CREATE_COOLDOWN)throw new Error('创建房间过于频繁，请稍后重试');
    const existing=rooms.get(client.room);
    if(rooms.size>=MAX_ROOMS&&(!existing||existing.members.size>1))throw new Error('当前房间较多，请稍后创建');
    client.lastCreateAt=now;
    if (client.room) leaveRoom(client);
    client.name = cleanName(data.name); client.character = allowedCharacters.has(data.character) ? data.character : 'fox';
    const room = { code: newCode(), hostId: client.id, members: new Map([[client.id, client]]), status: 'lobby', difficulty: allowedDifficulty.has(data.difficulty) ? data.difficulty : 'normal', trackId, mode, laps: 3, race: null, tick: 0, roundId: 0, eventSeq: 0, trackVotes: new Map(), lastActiveAt:now };
    rooms.set(room.code, room); client.room = room.code;
    send(client, roomState(room)); return;
  }
  if (data.type === 'join') {
    const code = String(data.room || data.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw new Error('没有找到这个房间，请检查房间码');
    if(!isRaceMode(room.mode))throw new Error(UPDATE_MESSAGE);
    if (room.status === 'racing') throw new Error('比赛已经开始，等待下一场');
    if (room.members.size >= 8 && !room.members.has(client.id)) throw new Error('房间已满，最多 8 人');
    if (client.room !== room.code) leaveRoom(client);
    client.name = cleanName(data.name); client.character = allowedCharacters.has(data.character) ? data.character : 'fox';
    room.members.set(client.id, client); client.room = room.code;
    room.lastActiveAt=performance.now();
    broadcast(room, roomState(room)); return;
  }
  const room = rooms.get(client.room);
  if (!room) throw new Error('请先创建或加入房间');
  if (data.type === 'configure' || data.type === 'returnToLobby') {
    if (client.id !== room.hostId) throw new Error('只有房主可以调整房间');
    if (data.type === 'configure') configureRoom(room, data, { trackIds: [...trackIds], modes: MULTIPLAYER_MODES, difficulties: [...allowedDifficulty] });
    else returnRoomToLobby(room);
    room.lastActiveAt = performance.now(); broadcast(room, roomState(room)); return;
  }
  if (data.type === 'voteTrack') {
    voteForTrack(room, client.id, data.trackId, [...trackIds]);
    room.lastActiveAt = performance.now(); broadcast(room, roomState(room)); return;
  }
  if (data.type === 'start') {
    if (client.id !== room.hostId) throw new Error('只有房主可以开始比赛');
    // A double click or a delayed request never resets an active/newer round.
    if (room.status === 'racing' || (data.roundId !== undefined && data.roundId !== room.roundId)) { send(client, roomState(room)); return; }
    if([...room.members.values()].some(member=>member.protocolVersion!==PROTOCOL_VERSION))throw new Error(UPDATE_MESSAGE);
    if ([...room.members.values()].filter(c=>c.ws.readyState===WebSocket.OPEN).length < 2) throw new Error('邀请一位朋友加入后即可开始比赛');
    room.trackId = trackVoteSummary(room, [...trackIds]).nextTrackId;
    room.race = new Race(roomTrack(room.trackId), {
      humanPlayers: [...room.members.values()].map(c => ({ id: c.id, name: c.name, character: c.character })),
      multiplayer: true, difficulty: room.difficulty, laps: room.laps, mode:room.mode,
    });
    room.race.disconnectedIds=new Set([...room.members.values()].filter(c=>c.ws.readyState!==WebSocket.OPEN).map(c=>c.id));
    room.tick = 0; room.roundId++; room.eventSeq = 0; room.trackVotes.clear(); room.status = 'racing'; room.lastActiveAt = performance.now(); room.race.start();
    for (const member of room.members.values()) { member.input = {}; member.inputAt = 0; member.seq = -1;member.itemUseSeq=0; }
    const state = withEventIds(room, room.race.snapshot());
    for (const member of room.members.values()) send(member, { type: 'started', ...protocolInfo,mode:room.mode,roomCode:room.code,roundId:room.roundId,playerId: member.id,lastItemUseSeq:0,state });
    broadcast(room, roomState(room)); return;
  }
  if (data.type === 'input') {
    if (!room.race || room.status !== 'racing') return;
    if (data.roundId !== undefined && data.roundId !== room.roundId) return;
    const seq = Number(data.seq);
    if (!Number.isSafeInteger(seq)||seq<0||seq<=client.seq) return;
    client.seq = seq;
    const input = data.input || {};
    const itemUseSeq=Number.isSafeInteger(input.itemUseSeq)&&input.itemUseSeq>=0?input.itemUseSeq:client.itemUseSeq;
    client.itemUseSeq=Math.max(client.itemUseSeq,itemUseSeq);
    client.input = {
      throttle: Math.max(0, Math.min(1, Number(input.throttle) || 0)),
      brake: Math.max(0, Math.min(1, Number(input.brake) || 0)),
      steer: Math.max(-1, Math.min(1, Number(input.steer) || 0)),
      drift: Boolean(input.drift), nitro: Boolean(input.nitro), useItem: Boolean(input.useItem),
      itemUseSeq:client.itemUseSeq,
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
    res.end(JSON.stringify({ ok: true, service: 'sunny-kart',...protocolInfo,tickRate: 60, snapshotRate: 20, trackIds: [...trackIds], rooms: rooms.size, clients: clients.size })); return;
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
wss.on('connection', (ws,request) => {
  const handshake=new URL(request.url,'http://localhost');
  if(handshake.searchParams.get('protocolVersion')!==String(PROTOCOL_VERSION)){
    ws.send(JSON.stringify({type:'protocolMismatch',...protocolInfo,message:UPDATE_MESSAGE}));ws.close(4004,'Client update required');return;
  }
  const resumeToken=handshake.searchParams.get('resume');
  let client=resumeToken?sessions.get(resumeToken):null;
  if(resumeToken&&(!client||!client.room||!rooms.has(client.room)||!client.disconnectedAt||performance.now()-client.disconnectedAt>RESUME_GRACE||client.ws.readyState===WebSocket.OPEN)){
    ws.send(JSON.stringify({type:'resumeRejected',message:'重连已过期或该席位已连接，请重新加入房间'}));ws.close(4003,'Resume unavailable');return;
  }
  if(clients.size>=MAX_CLIENTS){ws.send(JSON.stringify({type:'error',message:'当前在线人数较多，请稍后重试'}));ws.close(1013,'Server capacity reached');return;}
  const resumed=Boolean(client);
  if(resumed){sessions.delete(client.resumeToken);client.resumeToken=randomUUID()+randomUUID();}
  if(!client)client={id:randomUUID(),resumeToken:randomUUID()+randomUUID(),name:'晴空车手',character:'fox',room:null,input:{},seq:-1,itemUseSeq:0,protocolVersion:PROTOCOL_VERSION,inputAt:0,messages:0,rateAt:performance.now(),lastCreateAt:-Infinity};
  clearTimeout(client.expiryTimer);client.ws=ws;client.disconnectedAt=0;client.missedHeartbeats=0;
  clients.set(client.id,client);sessions.set(client.resumeToken,client);
  ws.on('pong',()=>{client.missedHeartbeats=0;});
  send(client,{type:'welcome',...protocolInfo,id:client.id,resumeToken:client.resumeToken,resumed,resumeGraceMs:RESUME_GRACE,lastSeq:client.seq,lastItemUseSeq:client.itemUseSeq,serverTime:Date.now(),trackIds:[...trackIds]});
  if(resumed){
    const room=rooms.get(client.room);room.race?.disconnectedIds?.delete(client.id);
    if(room.members.get(room.hostId)?.ws.readyState!==WebSocket.OPEN)room.hostId=client.id;
    broadcast(room,roomState(room));
    if(room.race){const message=snapshotMessage(room);broadcast(room,message);send(client,{type:'started',...protocolInfo,mode:room.mode,roomCode:room.code,roundId:room.roundId,playerId:client.id,lastItemUseSeq:client.itemUseSeq,state:{...message.state,events:[]},resumed:true});}
  }
  ws.on('message', bytes => {
    const now=performance.now();if(now-client.rateAt>1000){client.messages=0;client.rateAt=now;}
    if(++client.messages>120){send(client,{type:'error',message:'操作过于频繁，请稍后重试'});return;}
    try{receive(client,bytes.toString());}catch(error){send(client,{type:'error',message:error instanceof SyntaxError?'消息格式错误':error.message});}
  });
  ws.on('close',()=>{
    if(client.ws!==ws)return;
    clients.delete(client.id);
    const room=rooms.get(client.room);
    if(!room){sessions.delete(client.resumeToken);return;}
    client.disconnectedAt=performance.now();client.input={};client.inputAt=0;
    if(room.race){room.race.disconnectedIds??=new Set();room.race.disconnectedIds.add(client.id);const racer=room.race.racers.find(r=>r.id===client.id);if(racer){racer.lastItemUseSeq=Math.max(racer.lastItemUseSeq||0,client.itemUseSeq);racer.itemUseHeld=false;}}
    if(room.hostId===client.id){const next=[...room.members.values()].find(c=>c.ws.readyState===WebSocket.OPEN);if(next)room.hostId=next.id;}
    broadcast(room,roomState(room));
    client.expiryTimer=setTimeout(()=>{leaveRoom(client);sessions.delete(client.resumeToken);},RESUME_GRACE);client.expiryTimer.unref();
  });
  ws.on('error',()=>{});
});

const maintenance=setInterval(()=>{
  for(const client of clients.values()){
    if(client.missedHeartbeats>=2){client.ws.terminate();continue;}
    client.missedHeartbeats++;if(client.ws.readyState===WebSocket.OPEN)client.ws.ping();
  }
  const now=performance.now();
  for(const room of rooms.values())if(room.status!=='racing'&&now-room.lastActiveAt>LOBBY_IDLE){
    for(const client of [...room.members.values()]){send(client,{type:'error',message:'房间长时间没有操作，已自动关闭'});leaveRoom(client);client.ws.close(1000,'Room idle timeout');}
  }
},HEARTBEAT_INTERVAL);

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
      if (room.tick % 3 === 0 || room.race.phase === 'finished') broadcast(room, snapshotMessage(room));
      if (room.race.phase === 'finished') { room.status = 'finished';room.lastActiveAt=now; broadcast(room, roomState(room)); }
    }
  }
}, 1000 / 60);
server.listen(port, '0.0.0.0', () => console.log(`Sunny Kart multiplayer listening on http://0.0.0.0:${server.address().port} (WebSocket /ws, 60 Hz / 20 Hz)`));
function shutdown() {
  clearInterval(timer);
  clearInterval(maintenance);
  for(const client of sessions.values())clearTimeout(client.expiryTimer);
  for (const client of clients.values()) client.ws.close(1001, 'Server shutting down');
  wss.close(); server.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
