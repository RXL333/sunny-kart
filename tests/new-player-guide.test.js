import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { NewPlayerGuide, NEW_PLAYER_GUIDE_KEY } from '../src/new-player-guide.js';
import { DEFAULT_KEY_BINDINGS } from '../src/keyboard-bindings.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

function fixture(t, options = {}) {
  const window = new Window({ url: 'http://localhost/' }), document = window.document;
  document.body.innerHTML = `<div id="app" data-input-mode="${options.mode || 'keyboard'}">
    <header class="topbar"><button class="settings-button">设置</button><button class="help-button">操作说明</button></header>
    <main class="menu-screen"><div class="driver-picker"><button>阿橘</button></div><div class="difficulty-row">比赛节奏</div><button class="course-picker-button">换条赛道</button><button class="overview-button">航拍全图</button><section class="race-mode-picker">竞速赛 道具赛</section><div class="start-actions"><button class="start-button">出发，去兜风</button><button class="friend-button">好友联机</button><button class="time-trial-button">计时挑战</button></div><footer class="menu-footer"><div class="keyboard-guide"></div><button class="play-hub-button">杯赛 · 挑战 · 车库</button></footer></main>
    <aside class="already-inert" inert>保留原有不可交互状态</aside>
    <section class="overlay help-overlay" hidden><div class="dialog help-dialog"><button class="close-help">关闭</button><p class="help-footnote">操作说明</p></div></section>
    <section class="overlay settings-overlay" hidden><div class="dialog">游戏设置</div></section>
    <section class="race-hud" hidden></section>
  </div>`;
  const root = document.querySelector('#app'), storage = options.storage || memoryStorage();
  root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 });
  const guide = new NewPlayerGuide(root, { storage, ...options });
  t.after(() => window.close());
  return { window, document, root, guide, storage,
    modal: () => root.querySelector('.new-player-guide'),
    press(key, init = {}) {
      const event = new window.KeyboardEvent('keydown', { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, ...init });
      document.activeElement.dispatchEvent(event);
      return event;
    },
  };
}

test('first visit waits for readiness and dismissal persists without marking a mere opening as read', t => {
  let ready = false, opens = 0, closes = 0;
  const f = fixture(t, { canOpen: () => ready, onOpen: () => opens++, onClose: () => closes++ });
  f.guide.offer(); f.guide.update();
  assert.equal(f.guide.isOpen, false);
  assert.equal(f.storage.getItem(NEW_PLAYER_GUIDE_KEY), null);
  ready = true; f.guide.update();
  assert.equal(f.guide.isOpen, true);
  assert.equal(f.guide.step, 0);
  assert.equal(opens, 1);
  assert.equal(f.storage.getItem(NEW_PLAYER_GUIDE_KEY), null, 'opening alone does not acknowledge the tutorial');
  f.guide.close();
  assert.equal(f.guide.isOpen, false);
  assert.equal(f.storage.getItem(NEW_PLAYER_GUIDE_KEY), 'skipped');
  assert.equal(closes, 1);
  f.guide.offer(); f.guide.update();
  assert.equal(f.guide.isOpen, false, 'the same session does not repeatedly offer a dismissed guide');
  const reload = fixture(t, { storage: f.storage });
  reload.guide.offer(); reload.guide.update();
  assert.equal(reload.guide.isOpen, false, 'an explicit skip survives a page reload');
});

test('all seven sections can be read, completion is remembered, and replay starts from the beginning', t => {
  const f = fixture(t);
  f.guide.open();
  const titles = [];
  for (let step = 0; step < 7; step++) {
    assert.equal(f.guide.step, step);
    const title = f.root.querySelector('#guide-title');
    assert.ok(title?.textContent.trim());
    titles.push(title.textContent);
    if (step < 6) f.guide.next();
  }
  assert.equal(new Set(titles).size, 7, 'navigation visits seven distinct sections');
  f.guide.close();
  assert.equal(f.storage.getItem(NEW_PLAYER_GUIDE_KEY), 'done');
  const reload = fixture(t, { storage: f.storage });
  reload.guide.offer(); reload.guide.update();
  assert.equal(reload.guide.isOpen, false);
  const replay = reload.root.querySelector('.help-dialog .guide-replay');
  assert.ok(replay, 'help retains a replay entry after the automatic introduction is remembered');
  replay.click();
  assert.equal(reload.guide.isOpen, true);
  assert.equal(reload.guide.step, 0);
  reload.guide.next(); reload.guide.previous();
  assert.equal(reload.guide.step, 0);
});

test('the modal isolates background controls and restores their original inert state and focus', t => {
  const f = fixture(t), trigger = f.root.querySelector('.settings-button'), menu = f.root.querySelector('.menu-screen');
  trigger.focus();
  const originalInert = menu.inert;
  f.guide.open();
  assert.ok(f.modal().contains(f.document.activeElement), 'opening places keyboard focus inside the introduction');
  assert.equal(menu.inert, true);
  assert.ok(f.root.querySelector('.already-inert').hasAttribute('inert'));
  f.guide.close({ remember: false });
  assert.equal(Boolean(menu.inert), Boolean(originalInert));
  assert.ok(f.root.querySelector('.already-inert').hasAttribute('inert'), 'an existing inert attribute is preserved');
  assert.equal(f.document.activeElement, trigger);
  assert.equal(f.storage.getItem(NEW_PLAYER_GUIDE_KEY), null);
});

test('keyboard focus stays in the guide and gameplay keys and Escape do not leak to window handlers', t => {
  const f = fixture(t); let leaked = 0;
  f.window.addEventListener('keydown', () => leaked++);
  f.guide.open();
  const focusable = [...f.modal().querySelectorAll('button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]')].filter(node => !node.closest('[hidden]'));
  assert.ok(focusable.length >= 2);
  focusable.at(-1).focus();
  assert.equal(f.press('Tab').defaultPrevented, true);
  assert.equal(f.document.activeElement, focusable[0]);
  focusable[0].focus();
  assert.equal(f.press('Tab', { shiftKey: true }).defaultPrevented, true);
  assert.equal(f.document.activeElement, focusable.at(-1));
  f.press('w');
  assert.equal(leaked, 0, 'the existing throttle handler cannot receive tutorial input');
  const escape = f.press('Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.guide.isOpen, false);
  assert.equal(leaked, 0);
});

test('driving explanations follow customized desktop bindings and switch to touch instructions live', t => {
  const bindings = { ...DEFAULT_KEY_BINDINGS, throttle: ['KeyI'], brake: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], drift: ['KeyU'], nitro: ['KeyO'], useItem: ['KeyF'] };
  const f = fixture(t, { getBindings: () => bindings });
  f.guide.open();
  let copy = '';
  for (let step = 0; step < 7; step++) {
    copy += f.modal().textContent;
    if (step < 6) f.guide.next();
  }
  for (const label of ['I', 'K', 'J', 'L', 'U', 'O', 'F']) assert.match(copy, new RegExp(`\\b${label}\\b`), `current ${label} binding is explained`);
  assert.doesNotMatch(copy, /未设置/);
  f.root.dataset.inputMode = 'touch';
  f.root.dispatchEvent(new f.window.Event('inputmodechange'));
  f.guide.refresh();
  let touchCopy = '';
  f.guide.close({ remember: false });
  f.guide.open();
  for (let step = 0; step < 7; step++) {
    touchCopy += f.modal().textContent;
    if (step < 6) f.guide.next();
  }
  assert.match(touchCopy, /横屏/);
  assert.match(touchCopy, /转向/);
  assert.match(touchCopy, /拖动|拖拽/);
  assert.match(touchCopy, /漂移/);
  assert.match(touchCopy, /氮气/);
  assert.doesNotMatch(touchCopy, /未设置/);
});

test('unavailable storage still allows dismissing for the session and manual replay', t => {
  let saveErrors = 0;
  const f = fixture(t, { storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } }, onSaveError: () => saveErrors++ });
  f.guide.offer(); f.guide.update();
  assert.equal(f.guide.isOpen, true);
  f.guide.close();
  assert.equal(f.guide.isOpen, false);
  assert.equal(saveErrors, 1);
  f.guide.offer(); f.guide.update();
  assert.equal(f.guide.isOpen, false);
  f.root.querySelector('.guide-replay').click();
  assert.equal(f.guide.isOpen, true);
  assert.equal(f.guide.step, 0);
});

test('automatic offers wait behind other dialogs and a manual replay is blocked outside the menu', t => {
  let menu = true;
  const f = fixture(t, { canOpen: () => menu }), other = f.root.querySelector('.settings-overlay');
  other.hidden = false;
  f.guide.offer(); f.guide.update();
  assert.equal(f.guide.isOpen, false);
  other.hidden = true; f.guide.update();
  assert.equal(f.guide.isOpen, true);
  f.guide.close(); menu = false;
  f.guide.open();
  assert.equal(f.guide.isOpen, false);
  menu = true; f.guide.open();
  assert.equal(f.guide.isOpen, true);
});

test('corrupt stored progress is not treated as completed', t => {
  const f = fixture(t, { storage: memoryStorage({ [NEW_PLAYER_GUIDE_KEY]: '{broken' }) });
  f.guide.offer(); f.guide.update();
  assert.equal(f.guide.isOpen, true);
});

test('choosing driving practice closes the modal before launching the lesson', t => {
  const calls = [];
  const f = fixture(t, {
    onClose: () => calls.push('close'),
    onPractice: () => { assert.equal(f.guide.isOpen, false); calls.push('practice'); },
  });
  f.guide.open();
  for (let step = 0; step < 6; step++) f.guide.next();
  f.guide.close({ practice: true });
  assert.deepEqual(calls, ['close', 'practice']);
  assert.equal(f.storage.getItem(NEW_PLAYER_GUIDE_KEY), 'done');
});
