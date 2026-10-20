import test from 'node:test';
import assert from 'node:assert/strict';
import { Network } from '../src/network.js';

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
  assert.ok(inputs.every(message => JSON.stringify(message.input) === JSON.stringify(input)));
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
  const creating = network.create('fox', 'normal');
  const joining = network.join('ABC234', 'rabbit');
  await new Promise(resolve => setImmediate(resolve));
  const resolvedBeforeWelcome = resolved;
  const actionsBeforeWelcome = socket.sent.filter(message => ['create', 'join'].includes(message.type));
  socket.receive({ type: 'welcome', id: 'real-driver-7X9' });
  await Promise.all([connection, creating, joining]);
  assert.equal(resolvedBeforeWelcome, false, 'WebSocket open alone must not resolve connect');
  assert.equal(actionsBeforeWelcome.length, 0, 'Room actions must await welcome even when the socket is already open');
  assert.equal(network.id, 'real-driver-7X9');
  const create = socket.sent.find(message => message.type === 'create');
  const join = socket.sent.find(message => message.type === 'join');
  assert.equal(create.name, '阿橘·7X9'); assert.equal(create.character, 'fox'); assert.equal(create.difficulty, 'normal');
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
  socket.receive({ type: 'welcome', id: 'late-driver-8Q2' });
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
