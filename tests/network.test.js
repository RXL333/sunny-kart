import test from 'node:test';
import assert from 'node:assert/strict';
import { Network } from '../src/network.js';
import { PROTOCOL_VERSION, MULTIPLAYER_MODES, NETWORK_CAPABILITIES } from '../src/game/protocol.js';
const welcome = data => ({ type:'welcome',protocolVersion:PROTOCOL_VERSION,modes:[...MULTIPLAYER_MODES],capabilities:[...NETWORK_CAPABILITIES],trackIds:['sunny-island'],...data });

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    super(); this.url = url; this.readyState = FakeWebSocket.CONNECTING; this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  open() { this.readyState = FakeWebSocket.OPEN; this.dispatchEvent(new Event('open')); }
  receive(message) {
    const event = new Event('message');
    Object.defineProperty(event, 'data', { value: JSON.stringify(message) });
    this.dispatchEvent(event);
  }
  send(message) { assert.equal(this.readyState, FakeWebSocket.OPEN); this.sent.push(JSON.parse(message)); }
  close() {this.readyState=FakeWebSocket.CLOSED;this.dispatchEvent(new Event('close'));}
}

function stubBrowser(t) {
  const oldWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeWebSocket });
  Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { protocol: 'http:', hostname: 'localhost', host: 'localhost:3001' } });
  FakeWebSocket.instances = [];
  t.after(() => {
    if (oldWebSocket) Object.defineProperty(globalThis, 'WebSocket', oldWebSocket); else delete globalThis.WebSocket;
    if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation); else delete globalThis.location;
  });
}

test('network sends sequenced inputs at at most 30Hz only while racing, never in lobby or after leave', t => {
  stubBrowser(t);
  const network = new Network();
  const socket = new FakeWebSocket('ws://localhost:3001/ws'); socket.open(); network.socket = socket;
  const input = { throttle: 1, brake: 0, steer: 0.25, drift: false, nitro: false };
  for (let now = 1; now <= 1000; now++) network.update(now, input);
  network.room = { code: 'ABC234', status: 'lobby' };
  for (let now = 1001; now <= 2000; now++) network.update(now, input);
  assert.equal(socket.sent.filter(message => message.type === 'input').length, 0);
  network.room.status = 'racing';
  const times = [];
  for (let now = 2001; now <= 3000; now++) {
    const count = socket.sent.length; network.update(now, input);
    if (socket.sent.slice(count).some(message => message.type === 'input')) times.push(now);
  }
  const inputs = socket.sent.filter(message => message.type === 'input');
  assert.equal(inputs.length, 30);
  assert.deepEqual(inputs.map(message => message.seq), Array.from({ length: inputs.length }, (_, i) => i + 1));
  assert.ok(inputs.every(message => JSON.stringify(message.input) === JSON.stringify({...input,useItem:false,itemUseSeq:0})));
  assert.ok(times.slice(1).every((time, i) => time - times[i] >= 1000 / 30));
  network.leave();
  assert.equal(network.room, null);
  for (let now = 3001; now <= 4000; now++) network.update(now, input);
  network.room = { code: 'ABC234', status: 'finished' };
  for (let now = 4001; now <= 5000; now++) network.update(now, input);
  assert.equal(socket.sent.filter(message => message.type === 'input').length, inputs.length);
  assert.equal(socket.sent.filter(message => message.type === 'leave').length, 1);
});

test('connect and concurrent create/join wait for welcome identity, then use the real identity suffix', async t => {
  stubBrowser(t);
  const network = new Network();
  let resolved = false;
  const connection = network.connect().then(() => { resolved = true; });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  // Re-enter connect through room actions during the open-to-welcome window.
  const creating = network.create('fox', 'normal', 'candy-hills');
  const joining = network.join('ABC234', 'rabbit');
  await new Promise(resolve => setImmediate(resolve));
  const resolvedBeforeWelcome = resolved;
  const actionsBeforeWelcome = socket.sent.filter(message => ['create', 'join'].includes(message.type));
  socket.receive(welcome({ id: 'real-driver-7X9', trackIds: ['sunny-island','candy-hills'] }));
  await Promise.all([connection, creating, joining]);
  assert.equal(resolvedBeforeWelcome, false, 'WebSocket open alone must not resolve connect');
  assert.equal(actionsBeforeWelcome.length, 0, 'Room actions must await welcome even when the socket is already open');
  assert.equal(network.id, 'real-driver-7X9');
  const create = socket.sent.find(message => message.type === 'create');
  const join = socket.sent.find(message => message.type === 'join');
  assert.equal(create.name, '阿橘·7X9'); assert.equal(create.character, 'fox'); assert.equal(create.difficulty, 'normal');
  assert.equal(create.trackId, 'candy-hills');
  assert.equal(create.mode,'race');assert.equal(create.protocolVersion,PROTOCOL_VERSION);
  assert.equal(join.name, '薄荷·7X9'); assert.equal(join.room, 'ABC234'); assert.equal(join.character, 'rabbit');
  assert.equal(FakeWebSocket.instances.length, 1);
});

test('leaving while create awaits welcome cancels that room action and still permits a later create', async t => {
  stubBrowser(t);
  const network = new Network();
  const creating = network.create('fox', 'normal');
  const socket = FakeWebSocket.instances[0];
  socket.open();
  // Closing the lobby invokes leave before the server has assigned an identity.
  network.leave();
  assert.equal(network.roomGeneration, 1);
  assert.equal(socket.sent.filter(message => message.type === 'leave').length, 1);
  socket.receive(welcome({ id: 'late-driver-8Q2' }));
  await creating;
  assert.equal(network.room, null);
  assert.equal(socket.sent.filter(message => message.type === 'create').length, 0, 'An abandoned lobby must not create a room when welcome arrives late');

  await network.create('rabbit', 'easy');
  const actions = socket.sent.filter(message => message.type === 'create');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].name, '薄荷·8Q2');
  assert.equal(actions[0].character, 'rabbit');
  assert.equal(actions[0].difficulty, 'easy');
  assert.equal(FakeWebSocket.instances.length, 1);
});

test('a frontend rejects an old backend before creating any room', async t=>{
  stubBrowser(t);const network=new Network();
  const creating=network.create('fox','normal','starlight-canyon');
  const socket=FakeWebSocket.instances[0];socket.open();socket.receive({type:'welcome',id:'old-backend'});
  await assert.rejects(creating,/版本正在更新/);
  assert.equal(socket.sent.some(message=>message.type==='create'),false);
  assert.equal(network.id,null);assert.equal(socket.readyState,FakeWebSocket.CLOSED);
});

test('network restores a room after a transient close and explicit leave cancels recovery',async t=>{
  stubBrowser(t);let disconnected=0;
  const network=new Network({disconnected:()=>disconnected++});
  const connecting=network.connect(),first=FakeWebSocket.instances[0];first.open();first.receive(welcome({id:'same-id',resumeToken:'private-token',resumeGraceMs:2000}));await connecting;
  // Returning to single-player earlier must not prevent recovery of a later room.
  network.leave();await network.create();first.receive({type:'room',code:'ABC234',status:'racing'});
  first.readyState=FakeWebSocket.CLOSED;first.dispatchEvent(new Event('close'));
  assert.equal(network.reconnecting,true);assert.equal(disconnected,0);assert.equal(network.room.code,'ABC234');
  await new Promise(resolve=>setTimeout(resolve,550));
  const resumed=FakeWebSocket.instances.at(-1);assert.match(resumed.url,/resume=private-token/);resumed.open();resumed.receive(welcome({id:'same-id',resumeToken:'private-token',resumed:true,lastSeq:30}));
  assert.equal(network.id,'same-id');assert.equal(network.sequence,30);assert.equal(network.reconnecting,false);
  resumed.readyState=FakeWebSocket.CLOSED;resumed.dispatchEvent(new Event('close'));assert.equal(network.reconnecting,true);
  network.leave();assert.equal(network.reconnecting,false);assert.equal(network.room,null);assert.equal(disconnected,0);
});

test('late room and race messages cannot reopen a lobby after explicit leave',t=>{
 stubBrowser(t);let rooms=0,starts=0,snapshots=0;
 const network=new Network({room:()=>rooms++,started:()=>starts++,snapshot:()=>snapshots++});
 const socket=new FakeWebSocket('ws://localhost/ws');socket.open();network.socket=socket;network.room={code:'ABC234',status:'racing'};
 network.leave();network.message({type:'room',code:'ABC234',status:'racing'});network.message({type:'started',state:{}});network.message({type:'snapshot',tick:1,state:{racers:[]}});
 assert.equal(network.room,null);assert.equal(rooms+starts+snapshots,0);
});

test('manual item taps shorter than the input packet interval are retained and held keys do not repeat',t=>{
  stubBrowser(t);const network=new Network(),socket=new FakeWebSocket('ws://localhost/ws');socket.open();network.socket=socket;network.room={status:'racing',mode:'items'};
  const input={throttle:1,nitro:false,useItem:false};
  network.update(1000,input);
  network.update(1005,{...input,useItem:true});
  network.update(1010,input);
  network.update(1034,input);
  let commands=socket.sent.filter(message=>message.type==='input');
  assert.equal(commands.length,2);assert.equal(commands[1].input.useItem,false);
  assert.equal(commands[1].input.itemUseSeq,1,'release before the next packet cannot erase the manual action');
  assert.equal(commands[1].input.nitro,false,'manual items never release nitro');
  network.update(1070,{...input,useItem:true});network.update(1104,{...input,useItem:true});network.update(1138,{...input,useItem:true});
  commands=socket.sent.filter(message=>message.type==='input');
  assert.deepEqual(commands.slice(-3).map(command=>command.input.itemUseSeq),[2,2,2],'later packets retransmit the same action instead of creating more');
  assert.equal(network.history.commands.at(-1).input.itemUseSeq,2,'prediction replay retains the authority deduplication key');
});

test('a restored seat requires release before accepting another use, and a new race starts a new action sequence',t=>{
  stubBrowser(t);const network=new Network(),socket=new FakeWebSocket('ws://localhost/ws');socket.open();network.socket=socket;
  network.message(welcome({id:'seat',resumed:true,lastItemUseSeq:7}));
  network.message({type:'room',status:'racing',mode:'items'});
  network.message({type:'started',resumed:true,lastItemUseSeq:7,state:{racers:[{id:'seat',lastItemUseSeq:7}]}});
  network.update(1000,{useItem:true});network.update(1040,{useItem:true});
  assert.equal(network.itemUseSeq,7,'holding a pre-disconnect key cannot re-use an inventory item');
  network.update(1080,{useItem:false});network.update(1120,{useItem:true});
  assert.equal(network.itemUseSeq,8);
  network.message({type:'started',lastItemUseSeq:0,state:{racers:[{id:'seat',lastItemUseSeq:0}]}});
  network.update(1160,{useItem:false});network.update(1200,{useItem:true});
  assert.equal(network.itemUseSeq,1);
  network.leave();assert.equal(network.itemUseSeq,0);assert.equal(network.itemHeld,false);
});

test('item rooms announce their mode and require full compatible server capabilities',async t=>{
  stubBrowser(t);const network=new Network();
  const creating=network.create('panda','easy','sunny-island','items'),socket=FakeWebSocket.instances[0];
  assert.equal(new URL(socket.url).searchParams.get('protocolVersion'),String(PROTOCOL_VERSION));socket.open();socket.receive(welcome({id:'seat-123'}));await creating;
  assert.equal(socket.sent.find(message=>message.type==='create').mode,'items');
  network.message({type:'room',code:'ABC234',status:'lobby',mode:'items'});network.start();
  assert.equal(socket.sent.find(message=>message.type==='start').protocolVersion,PROTOCOL_VERSION);
  const incompatible=new Network(),connecting=incompatible.connect(),old=FakeWebSocket.instances.at(-1);
  old.open();old.receive(welcome({id:'partial',capabilities:['input-ack','seat-resume']}));
  await assert.rejects(connecting,/刷新游戏/);assert.equal(old.readyState,FakeWebSocket.CLOSED);
});

test('party commands send the current round and only supported configuration fields', t => {
  stubBrowser(t); const network = new Network(), socket = new FakeWebSocket('ws://localhost/ws');
  socket.open(); network.socket = socket; network.message(welcome({ id: 'host' }));
  network.message({ type: 'room', code: 'ABC234', status: 'finished', mode: 'items', roundId: 3 });
  network.configure({ trackId: 'bay-loop', mode: 'race', difficulty: 'easy', laps: 1, hostId: 'cheat' });
  network.voteTrack('candy-hills'); network.returnToLobby(); network.rematch();
  assert.deepEqual(socket.sent, [
    { type: 'configure', trackId: 'bay-loop', mode: 'race', difficulty: 'easy', laps: 1, protocolVersion: PROTOCOL_VERSION },
    { type: 'voteTrack', trackId: 'candy-hills', protocolVersion: PROTOCOL_VERSION },
    { type: 'returnToLobby', protocolVersion: PROTOCOL_VERSION },
    { type: 'start', roundId: 3, protocolVersion: PROTOCOL_VERSION },
  ]);
});

test('round event confirmation survives seat recovery and rejects duplicate, old-round and wrong-room packets', t => {
  stubBrowser(t); const starts = [], snapshots = [];
  const network = new Network({ started: state => starts.push(state), snapshot: state => snapshots.push(state) });
  const state = events => ({ racers: [{ id: 'seat' }], events });
  const start = (roundId, events = [], extra = {}) => ({ type: 'started', roundId, roomCode: 'ABC234', state: state(events), ...extra });
  const snapshot = (tick, events = [], extra = {}) => ({ type: 'snapshot', tick, roundId: 1, roomCode: 'ABC234', state: state(events), ...extra });
  const hit = { type: 'itemHit', eventId: 'ABC234:1:1' };
  network.message(welcome({ id: 'seat' }));
  network.message({ type: 'room', code: 'ABC234', status: 'racing' });
  network.message(start(1, [hit]));
  network.message(start(1, [hit]));
  assert.equal(starts.length, 1, 'repeated started cannot restart the race');
  network.message(snapshot(1, [hit]));
  assert.deepEqual(snapshots.at(-1).events, []);
  network.message(snapshot(2, [{ type: 'shieldBlock', eventId: 'ABC234:1:2' }]));
  network.message(snapshot(2, [{ type: 'itemHit', eventId: 'ABC234:1:3' }]));
  assert.equal(snapshots.length, 2, 'duplicate ticks cannot deliver duplicate effects');
  assert.equal(network.eventIds.has('ABC234:1:3'), false, 'unaccepted snapshots do not mark events consumed');
  network.message(welcome({ id: 'seat', resumed: true }));
  network.message(start(1, [hit], { resumed: true }));
  assert.deepEqual(starts.at(-1).events, [], 'same-round recovery cannot replay an already heard hit');
  network.message(snapshot(3, [{ type: 'itemHit', eventId: 'ABC234:1:3' }]));
  assert.equal(snapshots.at(-1).events.length, 1);
  network.message(start(2, [{ type: 'countdown', eventId: 'ABC234:2:1' }]));
  const count = snapshots.length;
  network.message(snapshot(4, [hit]));
  network.message(snapshot(4, [], { roundId: 2, roomCode: 'OTHER1' }));
  assert.equal(snapshots.length, count);
  network.message(start(1)); assert.equal(starts.length, 3, 'an old round cannot replace a rematch');
  network.message({ type: 'room', code: 'ABC234', status: 'lobby' });
  network.message(snapshot(5, [], { roundId: 2 }));
  assert.equal(snapshots.length, count, 'a late packet cannot restore a race after returning to the lobby');
});

test('confirmed event memory is bounded and leaving clears it for the next party', t => {
  stubBrowser(t); const network = new Network();
  for (let i = 0; i < 1400; i++) network.confirmedState({ events: [{ eventId: `event-${i}` }] });
  assert.equal(network.eventIds.size, 1024);
  assert.equal(network.eventIds.has('event-1399'), true);
  network.leave(); assert.equal(network.eventIds.size, 0);
});

test('replaced sockets cannot deliver late race messages into the active party', async t => {
  stubBrowser(t); const rooms = [], network = new Network({ room: room => rooms.push(room) });
  const connecting = network.connect(), old = FakeWebSocket.instances[0];
  old.open(); old.receive(welcome({ id: 'seat' })); await connecting;
  const current = new FakeWebSocket('ws://localhost/ws'); current.open(); network.socket = current;
  old.receive({ type: 'room', code: 'STALE1', status: 'racing' });
  assert.equal(rooms.length, 0); assert.equal(network.room, null);
  old.close(); network.leave();
});
