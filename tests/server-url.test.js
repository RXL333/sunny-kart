import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveServerUrl, healthUrl } from '../src/server-url.js';

const pages = { protocol: 'https:', hostname: 'rxl333.github.io', host: 'rxl333.github.io' };
const local = { protocol: 'http:', hostname: 'localhost', host: 'localhost:3001' };

test('Pages uses the configured secure backend, preserving explicit WebSocket paths', () => {
  assert.equal(resolveServerUrl({ configured: ' https://kart.example.com ', location: pages }), 'wss://kart.example.com/ws');
  assert.equal(resolveServerUrl({ configured: 'https://kart.example.com/ws', location: pages }), 'wss://kart.example.com/ws');
  assert.equal(resolveServerUrl({ configured: 'wss://kart.example.com:8443/racing/ws', location: pages }), 'wss://kart.example.com:8443/racing/ws');
  assert.equal(resolveServerUrl({ configured: 'https://kart.example.com/ws?ignored=1#fragment', location: pages }), 'wss://kart.example.com/ws');
  assert.equal(resolveServerUrl({ configured: 'http://localhost:4000', location: local }), 'ws://localhost:4000/ws');
});

test('server endpoints reject credentials, unsupported protocols and HTTPS mixed content', () => {
  for (const configured of ['https://user:password@kart.example.com', 'wss://user@kart.example.com/ws', 'ftp://kart.example.com', 'file:///ws', 'javascript:alert(1)']) {
    assert.throws(() => resolveServerUrl({ configured, location: pages }), /配置无效/, configured);
  }
  for (const configured of ['http://kart.example.com', 'ws://kart.example.com/ws']) {
    assert.throws(() => resolveServerUrl({ configured, location: pages }), /HTTPS \/ WSS/, configured);
  }
});

test('Pages without backend fails clearly while local and LAN production stay same origin', () => {
  assert.throws(() => resolveServerUrl({ location: pages }), /联机服务器尚未配置，单人比赛可以正常游玩/);
  assert.equal(resolveServerUrl({ location: local }), 'ws://localhost:3001/ws');
  for (const hostname of ['127.0.0.1', '10.0.0.4', '192.168.1.198', '172.16.0.4', '172.31.255.1']) {
    assert.equal(resolveServerUrl({ location: { protocol: 'http:', hostname, host: `${hostname}:3001` } }), `ws://${hostname}:3001/ws`);
  }
  assert.equal(resolveServerUrl({ location: { protocol: 'http:', hostname: '[::1]', host: '[::1]:3001' } }), 'ws://[::1]:3001/ws');
  assert.equal(resolveServerUrl({ location: { protocol: 'https:', hostname: '192.168.1.198', host: '192.168.1.198:8443' } }), 'wss://192.168.1.198:8443/ws');
  assert.throws(() => resolveServerUrl({ location: { protocol: 'https:', hostname: '172.32.0.4', host: '172.32.0.4' } }), /尚未配置/);
});

test('development selects the backend port and health URL targets the backend origin', () => {
  assert.equal(resolveServerUrl({ development: true, location: { protocol: 'http:', hostname: 'localhost', host: 'localhost:5173' } }), 'ws://localhost:3001/ws');
  assert.equal(resolveServerUrl({ development: true, location: { protocol: 'http:', hostname: '192.168.1.198', host: '192.168.1.198:5173' } }), 'ws://192.168.1.198:3001/ws');
  assert.equal(healthUrl('wss://kart.example.com/ws'), 'https://kart.example.com/health');
  assert.equal(healthUrl('wss://kart.example.com:8443/racing/ws'), 'https://kart.example.com:8443/health');
  assert.equal(healthUrl('ws://127.0.0.1:3001/ws'), 'http://127.0.0.1:3001/health');
});
