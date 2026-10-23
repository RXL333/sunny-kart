import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { TimeTrialUI, trialTime } from '../src/time-trial.js';
import { GhostStore, ghostDeltaAt, GHOST_PHYSICS_VERSION } from '../src/ghost.js';

const meta = { trackId: 'sunny-island', trackLength: 100, character: 'fox', laps: 3 };
function setup(t) {
  const window = new Window();
  t.after(() => window.close());
  const document = window.document;
  document.body.innerHTML = '<div id="app"><div class="start-actions"><button class="start-button">出发</button><button class="friend-button">好友联机</button></div><div class="ready-line" hidden><span>准备出发</span></div><div class="race-hud"><div class="position-panel">1/8</div></div><div class="result-stat-row"></div><p class="result-summary"></p></div>';
  const root = document.querySelector('#app');
  return { root, document };
}

test('native time trial entry blocks clicks while loading and becomes available on restart', t => {
  const { root } = setup(t); let starts = 0;
  const view = new TimeTrialUI(root, { onStart: () => starts++ });
  assert.equal(view.button.tagName, 'BUTTON'); assert.equal(view.button.type, 'button');
  assert.equal(view.button.parentElement.className, 'start-actions', 'entry remains outside the hidden landscape ready line');
  view.setBusy(true); view.button.click(); assert.equal(starts, 0);
  view.setBusy(false); view.button.click(); assert.equal(starts, 1);
  view.begin(meta); view.reset(); view.button.click(); assert.equal(starts, 2);
  assert.equal(root.querySelectorAll('.time-trial-button').length, 1);
});

test('paused trials keep a stable HUD; restarting clears old split and ahead state', t => {
  const { root } = setup(t), view = new TimeTrialUI(root);
  const best = { ...meta, time: 30, samples: [[0, 0, 0, 0, 0], [10, 100, 0, 0, 10], [20, 200, 0, 0, 10], [30, 300, 0, 0, 10]] };
  view.begin(meta, best);
  const race = { mode: 'time-trial', phase: 'racing', elapsed: 9, player: { distance: 100, lapTimes: [9], lastLapStartedAt: 9 } };
  view.update(race); assert.match(view.fields.delta.textContent, /领先 1.00/);
  const frozen = view.panel.textContent;
  view.update({ ...race, phase: 'paused', elapsed: 100 });
  assert.equal(view.panel.hidden, false); assert.equal(view.panel.textContent, frozen);
  view.begin(meta, best);
  assert.equal(view.fields['lap-feedback'].textContent, '');
  assert.equal(view.fields.delta.textContent, '等待发车');
  assert.equal(view.fields.delta.hasAttribute('data-ahead'), false);
  assert.equal(view.fields.lap.textContent, '本圈 00:00.00');
  race.elapsed = 0.1; race.player = { distance: 1, lapTimes: [], lastLapStartedAt: 0 }; view.update(race);
  assert.match(view.fields.lap.textContent, /00:00.10/);
});

test('returning to normal or multiplayer mode resets trial view and result details', t => {
  const { root } = setup(t), view = new TimeTrialUI(root);
  view.begin(meta);
  view.finish({ race: { mode: 'time-trial', track: { name: '海岛' }, player: { lapTimes: [10, 11, 12] } }, saveResult: { reason: 'slower' } });
  assert.equal(view.result.hidden, false);
  view.reset();
  view.update({ mode: 'race', phase: 'racing', elapsed: 100, player: { distance: 200 } });
  assert.equal(view.active, false); assert.equal(view.panel.hidden, true); assert.equal(view.result.hidden, true);
  assert.equal(root.classList.contains('time-trial-active'), false);
  view.begin({ ...meta, character: 'rabbit', trackId: 'bay-loop' });
  assert.equal(view.best, null); assert.match(view.fields.delta.textContent, /首次挑战/);
});

test('result text separates a new record, slower run, storage failure and invalid recording', t => {
  const { root } = setup(t), view = new TimeTrialUI(root), race = { mode: 'time-trial', track: { name: '<unsafe>' }, player: { lapTimes: [10, 11, 12] } };
  for (const [reason, text] of [['best', '新的个人最佳'], ['slower', '最快幽灵已保留'], ['storage', '浏览器未能保存'], ['invalid', '本次轨迹未保存']]) {
    view.begin(meta); view.finish({ race, saveResult: { reason } });
    assert.match(view.result.textContent, new RegExp(text));
    assert.equal(view.result.querySelectorAll('li').length, 3);
    assert.equal(root.querySelector('unsafe'), null);
  }
  assert.equal(trialTime(NaN), '--:--.--'); assert.equal(trialTime(-1), '--:--.--');
  assert.equal(trialTime(59.999), '01:00.00');
});

test('delta index preserves earliest crossing through reversals, stops and lap boundaries', () => {
  const record = { trackLength: 10, laps: 3, samples: [[0, 0], [1, 10], [2, 5], [3, 20], [4, 20], [5, 15], [6, 30]] };
  assert.equal(ghostDeltaAt(record, 0, 0), 0);
  assert.equal(ghostDeltaAt(record, 10, 1), 0);
  assert.ok(Math.abs(ghostDeltaAt(record, 12, 3) - (3 - (2 + 7 / 15))) < 1e-9);
  assert.equal(ghostDeltaAt(record, 20, 3), 0, 'a stopped or repeated line retains its first crossing');
  assert.equal(ghostDeltaAt(record, 30, 6), 0);
  assert.equal(ghostDeltaAt(record, 31, 6), null);
  // Seek back after caching; lookup is independent of previous query order.
  assert.equal(ghostDeltaAt(record, 5, 1), 0.5);
});

test('long ghosts are indexed once and subsequent delta lookup touches no source samples', () => {
  let reads = 0;
  const samples = Array.from({ length: 18_001 }, (_, i) => new Proxy([i / 10, i, 0, 0, 10], { get(target, key) { if (key === '1') reads++; return Reflect.get(target, key); } }));
  const record = { trackLength: 6000, laps: 3, samples };
  assert.equal(ghostDeltaAt(record, 17_999, 1799.9), 0);
  assert.ok(reads > 18_000);
  reads = 0;
  for (let i = 0; i < 100; i++) assert.ok(Number.isFinite(ghostDeltaAt(record, i * 100, i * 10)));
  assert.equal(reads, 1, 'only the zero-distance query reads the first pose');
});

test('session best survives a denied persistence write and later slower saves', () => {
  const recording = { schema: 1, mode: 'time-trial', ...meta, physicsVersion: GHOST_PHYSICS_VERSION, time: 30, samples: Array.from({ length: 301 }, (_, i) => [i / 10, i, 0, 0, 10]) };
  const store = new GhostStore({ storage: { getItem() { return null; }, setItem() { throw new Error('full'); } } });
  assert.equal(store.save(recording).reason, 'storage');
  assert.equal(store.load(meta), recording);
  assert.equal(store.save(recording).reason, 'slower');
});
