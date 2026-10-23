const foxIcon = `<svg viewBox="0 0 80 80" aria-hidden="true"><path fill="#ef874d" d="M13 11 33 24h14L67 11l-2 38c-2 13-12 22-25 22S17 62 15 49Z"/><path fill="#563e3c" d="m18 19 11 11-10 7Zm44 0L51 30l10 7Z"/><path fill="#fff0d8" d="M16 43q12 0 24 14 12-14 24-14c1 15-11 25-24 25S15 58 16 43"/><ellipse cx="29" cy="42" rx="3" ry="4" fill="#243e49"/><ellipse cx="51" cy="42" rx="3" ry="4" fill="#243e49"/><path d="m35 54 5 5 5-5" fill="#243e49"/><path d="M36 62q4 3 8 0" fill="none" stroke="#243e49" stroke-width="2" stroke-linecap="round"/></svg>`;
const rabbitIcon = `<svg viewBox="0 0 80 80" aria-hidden="true"><ellipse cx="27" cy="23" rx="9" ry="21" fill="#e9f8df" transform="rotate(-13 27 23)"/><ellipse cx="53" cy="23" rx="9" ry="21" fill="#e9f8df" transform="rotate(13 53 23)"/><ellipse cx="27" cy="22" rx="4" ry="13" fill="#9bd3b8" transform="rotate(-13 27 22)"/><ellipse cx="53" cy="22" rx="4" ry="13" fill="#9bd3b8" transform="rotate(13 53 22)"/><ellipse cx="40" cy="49" rx="28" ry="25" fill="#e9f8df"/><ellipse cx="29" cy="46" rx="3" ry="4" fill="#243e49"/><ellipse cx="51" cy="46" rx="3" ry="4" fill="#243e49"/><path d="m36 56 4 4 4-4" fill="#ef9990"/><path d="M34 64q6 4 12 0" fill="none" stroke="#243e49" stroke-width="2" stroke-linecap="round"/></svg>`;
const pandaIcon = `<svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="20" cy="23" r="13" fill="#39495f"/><circle cx="60" cy="23" r="13" fill="#39495f"/><ellipse cx="40" cy="45" rx="29" ry="28" fill="#fff5df"/><ellipse cx="27" cy="42" rx="9" ry="11" fill="#39495f" transform="rotate(24 27 42)"/><ellipse cx="53" cy="42" rx="9" ry="11" fill="#39495f" transform="rotate(-24 53 42)"/><circle cx="29" cy="41" r="3" fill="white"/><circle cx="51" cy="41" r="3" fill="white"/><path d="m35 55 5 5 5-5" fill="#39495f"/><path d="M35 64q5 4 10 0" fill="none" stroke="#39495f" stroke-width="2" stroke-linecap="round"/></svg>`;
const icons = { fox: foxIcon, rabbit: rabbitIcon, panda: pandaIcon };
const chars = { fox: { name: '阿橘', subtitle: '永远向着阳光', color: '#ef874d' }, rabbit: { name: '薄荷', subtitle: '风一样的好心情', color: '#70bea3' }, panda: { name: '波波', subtitle: '慢热，但绝不慢', color: '#a29bce' } };
const volumeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>`;
const pauseIcon = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></svg>`;
const arrowIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>`;
const boltIcon = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2 4 14h7l-1 8L21 9h-8Z"/></svg>`;
const timeText = value => { const seconds = Math.max(0, Number(value) || 0); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`; };
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

import { TouchControls } from './touch-controls.js';
import { MobileExperience } from './mobile.js';
import { KEYBOARD_ACTIONS, DEFAULT_KEY_BINDINGS, validateKeyBindings, keyLabel } from './keyboard-bindings.js';

export class UI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.character = 'fox';
    this.difficulty = 'normal';
    this.phase = 'menu';
    this.autoThrottle = false;
    this.autoThrottleChosen=false;
    this.touchState = { throttle: 0, brake: 0, steer: 0, drift: false, nitro: false, useItem: false };
    this.root = document.querySelector('#app');
    this.root.innerHTML = `
      <header class="topbar">
        <a class="brand" href="#" aria-label="晴空卡丁车首页"><span class="brand-emblem">S<span>★</span></span><span class="brand-word">晴空卡丁车<small>SUNNY KART</small></span></a>
        <div class="top-actions"><span class="network-status" hidden></span><button class="icon-button fullscreen-button" aria-label="全屏游玩" title="全屏游玩" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button><button class="icon-button sound-button" aria-label="关闭声音" title="声音">${volumeIcon}</button><button class="icon-button help-button" aria-label="查看操作说明" title="操作说明">?</button><button class="icon-button pause-button" aria-label="暂停比赛" title="暂停比赛" hidden>${pauseIcon}</button></div>
      </header>
      <main class="menu-screen">
        <div class="menu-copy"><div class="eyebrow"><span class="sun-symbol">✳</span> 阳光海岛大奖赛 <span class="edition">VOL. 01</span></div><h1>把快乐，<br>开上<span class="title-sky">晴空<svg viewBox="0 0 160 18" aria-hidden="true"><path d="M4 12Q76-3 155 9"/></svg></span>。</h1><p class="menu-description">海风正好，弯道在前。<br>和小伙伴一起，漂移进一个晴朗的好日子。</p>
        <div class="driver-picker"><div class="section-label"><span>选择你的搭档</span><span class="driver-motto">永远向着阳光</span></div><div class="driver-options">${Object.entries(chars).map(([key, c]) => `<button class="driver-option ${key === 'fox' ? 'selected' : ''}" data-character="${key}" aria-label="选择车手${c.name}" aria-pressed="${key === 'fox'}"><span class="driver-portrait" style="--driver-color:${c.color}">${icons[key]}</span><span>${c.name}</span><span class="selection-dot"></span></button>`).join('')}</div></div>
        <div class="difficulty-row"><span class="section-label">比赛节奏</span><div class="difficulty-options" role="group" aria-label="选择比赛难度"><button data-difficulty="easy" aria-pressed="false">轻松兜风</button><button class="selected" data-difficulty="normal" aria-pressed="true">标准竞速</button><button data-difficulty="hard" aria-pressed="false">全力以赴</button></div></div>
        <div class="start-actions"><button class="primary-button start-button"><span>出发，去兜风</span><span class="button-arrow">${arrowIcon}</span></button><button class="friend-button" aria-label="打开好友联机"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 6a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5"/></svg><span>好友联机</span></button></div>
        <div class="ready-line"><span class="ready-dot"></span><span class="loading-label">3 圈竞速 · 8 位车手 · 一路好心情</span></div></div>
        <div class="course-stamp"><span class="course-number">01</span><div><span>今日目的地</span><strong>晴风海岸</strong><small>SUNSHINE COAST</small></div><span class="course-weather">☀<small>26°</small></span></div>
        <footer class="menu-footer"><div class="keyboard-guide"><span><kbd>W A S D</kbd> 驾驶</span><span><kbd>SHIFT</kbd> 漂移</span><span><kbd>SPACE</kbd> 氮气</span></div><span class="mobile-hint">横屏更尽兴 · 左手转向，右手漂移与氮气</span><span class="footer-note">好好过弯，也好好看风景。</span></footer>
      </main>
      <section class="race-hud" aria-label="比赛信息" hidden>
        <button class="auto-throttle-button" aria-label="自动油门" aria-pressed="false"><span class="auto-dot"></span>自动油门 <kbd>Q</kbd></button>
        <div class="lap-panel"><span class="hud-caption">LAP / 圈数</span><div><strong class="lap-value">1</strong><span class="lap-total"> / 3</span></div><span class="race-time">00:00.00</span></div>
        <div class="position-panel"><span class="position-value">8</span><span class="position-suffix">TH</span><span class="position-total">/ 8</span><small>当前名次</small></div>
        <div class="minimap-panel"><canvas id="minimap" width="192" height="152" aria-label="赛道小地图"></canvas><span>晴风海岸 <i>●</i> LIVE</span></div>
        <div class="nitro-panel"><span class="nitro-symbol">${boltIcon}</span><div><div class="nitro-heading"><strong>晴空氮气</strong><span class="nitro-value">0%</span></div><div class="nitro-track"><span></span></div><small><kbd>SPACE</kbd> / <kbd>N</kbd> 释放加速</small></div></div>
        <div class="speed-panel"><span class="speed-value">0</span><span class="speed-unit">KM/H</span><div class="drift-heading"><span class="drift-label">漂移蓄力</span><span>SHIFT</span></div><div class="drift-track"><span></span></div></div>
        <div class="race-hint"><kbd>W</kbd> 加速 <span>·</span> <kbd>SHIFT</kbd> 漂移 <span>·</span> <kbd>ESC</kbd> 暂停</div>
      </section>
      <div class="countdown" aria-live="assertive" hidden><span></span><small>准备好，向快乐出发！</small></div>
      <div class="toast" role="status" hidden></div>
      <section class="overlay pause-overlay" hidden><div class="dialog pause-dialog"><span class="dialog-eyebrow">TAKE A LITTLE BREAK</span><h2>让风等一下。</h2><p>赛道上的快乐，随时可以继续。</p><button class="primary-button resume-button"><span>继续比赛</span>${arrowIcon}</button><button class="plain-button restart-button">重新出发</button><button class="plain-button menu-button">回到主菜单</button></div></section>
      <section class="overlay help-overlay" hidden><div class="dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><button class="close-button close-help" aria-label="关闭操作说明">×</button><span class="dialog-eyebrow">A LITTLE HOW-TO</span><h2 id="help-title">三分钟，变身弯道高手。</h2><div class="help-list"><div><span class="help-keys"><kbd>W</kbd><kbd>↑</kbd></span><p><strong>踩下油门</strong><small>持续按住加速，S / ↓ 刹车；Q 切换自动油门。</small></p></div><div><span class="help-keys"><kbd>A</kbd><kbd>D</kbd></span><p><strong>转向与过弯</strong><small>也可使用 ← →。草地会让赛车减速。</small></p></div><div><span class="help-keys"><kbd>SHIFT</kbd></span><p><strong>漂移，攒一点惊喜</strong><small>转弯时按住漂移，蓄力后松开获得加速。</small></p></div><div><span class="help-keys"><kbd>SPACE</kbd></span><p><strong>释放晴空氮气</strong><small>漂移补充能量，按住空格 / N 提速。</small></p></div></div><p class="help-footnote">Esc 暂停比赛 · R 重新比赛 · 完成 3 圈就能抵达终点</p><button class="primary-button close-help"><span>明白了，去追风</span>${arrowIcon}</button></div></section>
      <section class="overlay results-overlay" hidden><div class="dialog results-dialog" role="dialog" aria-modal="true" aria-labelledby="results-title"><span class="dialog-eyebrow">WHAT A SUNNY RIDE!</span><div class="results-medal">★</div><h2 id="results-title">把好心情，带回家。</h2><p class="result-summary">你完成了晴风海岸的挑战</p><div class="result-stat-row"><div><small>完赛用时</small><strong class="result-time">00:00.00</strong></div><div><small>个人最佳</small><strong class="result-best">--:--.--</strong></div></div><div class="result-list" aria-label="比赛排名"></div><button class="primary-button restart-button"><span>再来一场</span>${arrowIcon}</button><button class="plain-button menu-button">回到主菜单</button></div></section>
      <section class="overlay lobby-overlay" hidden><div class="dialog lobby-dialog" role="dialog" aria-modal="true" aria-labelledby="lobby-title"><button class="close-button close-lobby" aria-label="关闭联机面板">×</button><span class="dialog-eyebrow">GOOD COMPANY, GREAT RACE</span><h2 id="lobby-title">好朋友，一起追风。</h2><p class="lobby-description">创建一个小房间，分享房间号就能一起出发。</p><div class="room-entry"><button class="primary-button create-room-button"><span>创建好友房间</span>${arrowIcon}</button><div class="join-divider">或者，加入朋友的房间</div><form class="join-form"><label for="room-code-input" class="sr-only">6 位房间号</label><input id="room-code-input" inputmode="text" maxlength="6" placeholder="输入 6 位房间号" autocomplete="off" spellcheck="false" pattern="[A-Za-z0-9]{6}" required/><button class="join-room-button" type="submit">加入</button></form></div><div class="room-content" hidden><div class="room-code-line"><span>分享房间号</span><strong class="room-code">------</strong><button class="copy-room-button" aria-label="复制房间号" title="复制房间号">复制</button></div><div class="lobby-players"></div><p class="room-tip">最多 8 位好友，其余车位由 AI 车手补齐。</p><button class="primary-button start-room-button"><span>全员上车，出发！</span>${arrowIcon}</button><p class="waiting-host" hidden>等待房主开始比赛…</p><button class="plain-button leave-room-button">退出房间</button></div><div class="lobby-status" role="status">连接后就可以一起出发</div></div></section>
      <div class="touch-controls" hidden><div class="touch-steering"><button data-touch="left" aria-label="向左转向">◀</button><button data-touch="right" aria-label="向右转向">▶</button></div><div class="touch-driving"><button data-touch="drift" class="touch-drift" aria-label="漂移">漂移</button><button data-touch="nitro" class="touch-nitro" aria-label="使用氮气">${boltIcon}</button><button data-touch="brake" class="touch-brake" aria-label="刹车">刹车</button><button data-touch="throttle" class="touch-throttle" aria-label="加速">油门</button></div></div>
    `;
    const itemButton=document.createElement('button');itemButton.dataset.touch='useItem';itemButton.className='touch-item';itemButton.setAttribute('aria-label','使用道具');itemButton.hidden=true;itemButton.innerHTML='<span aria-hidden="true">✦</span><small>道具</small>';this.root.querySelector('.touch-controls').append(itemButton);
    this.el = selector => this.root.querySelector(selector);
    this.all = selector => [...this.root.querySelectorAll(selector)];
    this.minimap = this.el('#minimap');
    const rotate=document.createElement('section');rotate.className='overlay rotate-overlay';rotate.hidden=true;rotate.setAttribute('role','dialog');rotate.setAttribute('aria-modal','true');rotate.setAttribute('aria-labelledby','rotate-title');
    rotate.innerHTML='<div class="rotate-card"><span class="rotate-phone" aria-hidden="true">↶ ▯</span><h2 id="rotate-title">横过手机，更好过弯。</h2><p>左手转向，右手漂移和氮气。<br><span class="rotate-status">单人比赛已为你暂停。</span></p><button class="primary-button rotate-fullscreen">全屏横向游玩 ↗</button><button class="plain-button rotate-dismiss">先竖屏继续</button></div>';this.root.append(rotate);
    const touchHint=document.createElement('p');touchHint.className='touch-hint';touchHint.textContent='手机：默认自动油门；左侧左右转向，转弯时右手按住漂移、松开小喷，⚡ 按住释放氮气。刹车可降低车速；关闭自动油门后按住油门手动驾驶。';this.el('.help-list').before(touchHint);
    const overviewButton=document.createElement('button');overviewButton.className='overview-button';overviewButton.textContent='航拍全图 ↗';overviewButton.setAttribute('aria-label','航拍全图');
    this.el('.course-stamp > div').append(overviewButton);
    const overviewReturn=document.createElement('button');overviewReturn.className='overview-return';overviewReturn.textContent='← 返回发车区';overviewReturn.hidden=true;this.root.append(overviewReturn);
    const toggleOverview=()=>this.setOverview(!this.overview);
    overviewButton.addEventListener('click',toggleOverview);overviewReturn.addEventListener('click',toggleOverview);
    const leaveButton = document.createElement('button');
    leaveButton.className = 'icon-button leave-race-button';
    leaveButton.setAttribute('aria-label', '退出联机比赛');
    leaveButton.title = '退出联机比赛';
    leaveButton.textContent = '↗'; leaveButton.hidden = true;
    leaveButton.addEventListener('click', () => this.callbacks.onMenu?.());
    this.el('.top-actions').append(leaveButton);
    const settingsButton=document.createElement('button');settingsButton.className='icon-button settings-button';settingsButton.setAttribute('aria-label','游戏设置');settingsButton.title='游戏设置';settingsButton.textContent='⚙';this.el('.top-actions').append(settingsButton);
    this.bind();
    const keyboardHelp=this.el('.help-list').cloneNode(false);keyboardHelp.classList.add('keyboard-help-list');
    this.el('.help-list').classList.add('touch-help-list');this.el('.touch-help-list').after(keyboardHelp);
    const keyboardFootnote=this.el('.help-footnote').cloneNode(false);keyboardFootnote.classList.add('keyboard-help-footnote');
    this.el('.help-footnote').classList.add('touch-help-footnote');this.el('.touch-help-footnote').after(keyboardFootnote);
    this.setKeyBindings(DEFAULT_KEY_BINDINGS);
    if(this.root.ownerDocument.defaultView.ResizeObserver){
      this.hintObserver=new this.root.ownerDocument.defaultView.ResizeObserver(()=>this.measureKeyboardHint());
      this.hintObserver.observe(this.el('.race-hint'));
      this.hintObserver.observe(this.el('.menu-footer'));
    }
    this.setAutoThrottle(this.autoThrottle,false);
    this.mobile=new MobileExperience(this.root,{clear:()=>{this.clearTouch();this.callbacks.onInputModeChange?.();},toast:text=>this.showToast(text),mode:(touch,hardware)=>{if(!this.autoThrottleChosen&&!this.root.classList.contains('in-race'))this.setAutoThrottle(touch&&hardware,false);}});
  }

  bind() {
    this.el('.brand').addEventListener('click', e => { e.preventDefault(); if (this.phase === 'menu' || this.phase === 'lobby') return; this.callbacks.onPause?.(); });
    this.all('[data-character]').forEach(button => button.addEventListener('click', () => {
      this.character = button.dataset.character;
      this.all('[data-character]').forEach(b => { const selected = b === button; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', selected); });
      this.el('.driver-motto').textContent = this.driverTitle || chars[this.character].subtitle;
      this.callbacks.onCharacterChange?.(this.character);
    }));
    this.all('[data-difficulty]').forEach(button => button.addEventListener('click', () => {
      this.difficulty = button.dataset.difficulty;
      this.all('[data-difficulty]').forEach(b => { const selected = b === button; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', selected); });
    }));
    this.el('.start-button').addEventListener('click', () => { this.callbacks.onStart?.({ character: this.character, difficulty: this.difficulty }); });
    this.el('.pause-button').addEventListener('click', () => this.callbacks.onPause?.());
    this.el('.auto-throttle-button').addEventListener('click', () => this.setAutoThrottle(!this.autoThrottle));
    this.el('.resume-button').addEventListener('click', () => { this.setPaused(false); this.callbacks.onResume?.(); });
    this.all('.restart-button').forEach(b => b.addEventListener('click', () => this.callbacks.onRestart?.()));
    this.all('.menu-button').forEach(b => b.addEventListener('click', () => { this.showMenu(); this.callbacks.onMenu?.(); }));
    this.el('.sound-button').addEventListener('click', () => { this.setMuted(!this.muted); this.callbacks.onMute?.(this.muted); });
    this.el('.help-button').addEventListener('click', () => this.showHelp());
    this.all('.close-help').forEach(b => b.addEventListener('click', () => this.hideHelp()));
    this.el('.friend-button').addEventListener('click', () => this.openLobby());
    this.el('.close-lobby').addEventListener('click', () => { this.callbacks.onLeaveRoom?.(); this.room = null; this.showMenu(); });
    this.el('.create-room-button').addEventListener('click', () => { this.el('.lobby-status').textContent = '正在创建房间…'; this.callbacks.onCreateRoom?.({ character: this.character, difficulty: this.difficulty }); });
    this.el('.join-form').addEventListener('submit', e => { e.preventDefault(); const code = this.el('#room-code-input').value.trim().toUpperCase(); if (/^[A-Z0-9]{6}$/.test(code)) { this.el('.lobby-status').textContent = '正在加入房间…'; this.callbacks.onJoinRoom?.(code, { character: this.character, difficulty: this.difficulty }); } });
    this.el('#room-code-input').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
    this.el('.start-room-button').addEventListener('click', () => this.callbacks.onStartRoom?.());
    this.el('.leave-room-button').addEventListener('click', () => { this.callbacks.onLeaveRoom?.(); this.room = null; this.showMenu(); });
    this.el('.copy-room-button').addEventListener('click', async () => { try { await navigator.clipboard.writeText(this.room?.code || ''); this.showToast('房间号已复制，邀请好朋友来追风吧'); } catch { this.showToast(`房间号：${this.room?.code || ''}`); } });
    this.touchControls=new TouchControls(this.all('[data-touch]'),{state:this.touchState,onChange:state=>{if(state.useItem&&!this.itemHeld)this.callbacks.onItemPress?.();this.itemHeld=state.useItem;}});
  }

  beginRace() {
    this.setOverview(false);
    this.phase = 'countdown';
    this.hideOverlays();
    this.el('.menu-screen').hidden = true;
    this.el('.race-hud').hidden = false;
    this.el('.pause-button').hidden = false;
    this.el('.touch-controls').hidden = false;
    this.root.classList.add('in-race');
    this.clearTouch();
    this.mobile?.beginRace();
  }

  enterRace() { this.beginRace(); }

  showMenu() {
    this.setOverview(false);
    this.phase = 'menu';
    this.hideOverlays();
    this.el('.menu-screen').hidden = false;
    this.el('.race-hud').hidden = true;
    this.el('.pause-button').hidden = true;
    this.el('.touch-controls').hidden = true;
    this.el('.countdown').hidden = true;
    this.root.classList.remove('in-race');
    this.clearTouch();
    this.mobile?.sync();
  }

  hideOverlays() { this.all('.overlay:not(.settings-overlay)').forEach(el => { el.hidden = true; }); }
  clearTouch() { this.touchControls?.clear(); }

  update(state = {}) {
    const player = state.player || {};
    if (player.id) this.playerId = player.id;
    const phase = state.phase;
    if (phase && phase !== 'menu') this.phase = phase;
    if (phase === 'paused') this.setPaused(true);
    else if (phase === 'racing' && !this.el('.pause-overlay').hidden) this.setPaused(false);
    const totalLaps = state.laps || state.totalLaps || 3;
    this.el('.lap-value').textContent = Math.min(totalLaps, Math.max(1, player.lap || state.lap || 1));
    this.el('.lap-total').textContent = ` / ${totalLaps}`;
    this.el('.race-time').textContent = timeText(state.elapsed ?? state.time ?? state.raceTime ?? 0);
    const position = Math.max(1, player.position || state.position || 8);
    this.el('.position-value').textContent = position;
    this.el('.position-suffix').textContent = position === 1 ? 'ST' : position === 2 ? 'ND' : position === 3 ? 'RD' : 'TH';
    this.el('.position-total').textContent = `/ ${state.racers?.length || state.totalRacers || 8}`;
    this.el('.speed-value').textContent = Math.round(Math.max(0, player.speed || 0) * 3.6);
    const rawNitro = Number(player.nitro ?? player.nitroCharge ?? 0);
    const nitro = Math.max(0, Math.min(100, player.nitroMax ? rawNitro / player.nitroMax * 100 : rawNitro));
    this.el('.nitro-value').textContent = `${Math.round(nitro)}%`;
    this.el('.nitro-track span').style.width = `${nitro}%`;
    this.el('.nitro-panel').classList.toggle('nitro-ready', nitro >= 25);
    const charge = Math.max(0, Math.min(100, (player.driftCharge || 0) / (player.maxDriftCharge || 1) * 100));
    this.el('.drift-track span').style.width = `${charge}%`;
    const stage=player.driftStage||0;this.el('.speed-panel').dataset.driftStage=String(stage);
    this.el('.drift-label').textContent = player.driftBoost > 0 ? '出弯小喷！' : stage > 0 ? ['','蓝焰 · 松开小喷','金焰 · 松开强喷','紫焰 · 松开完美喷'][stage] : '漂移蓄力';
    this.el('.speed-panel').classList.toggle('boosting', player.boost > 0);
  }

  showCountdown(text) {
    const el = this.el('.countdown');
    const content = text === null || text === undefined ? '' : String(text);
    if (!content) { el.hidden = true; return; }
    const value = el.querySelector('span');
    if (value.textContent !== content) { value.textContent = content; value.classList.remove('count-pop'); void value.offsetWidth; value.classList.add('count-pop'); }
    el.hidden = false;
  }

  showToast(message) {
    const el = this.el('.toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  setLoading(progress) {
    const p = Math.min(1, Math.max(0, Number(progress) || 0));
    this.loading = p < 1;
    this.el('.start-button').disabled = p < 1;
    this.el('.friend-button').disabled = p < 1;
    if(this.room)this.el('.start-room-button').disabled=p<1||(this.room.players?.filter(player=>player.connected!==false).length||0)<2;
    this.el('.loading-label').textContent = p >= 1 ? '3 圈竞速 · 8 位车手 · 一路好心情' : `正在准备晴空海岸… ${Math.round(p * 100)}%`;
    this.el('.ready-dot').classList.toggle('loading', p < 1);
  }

  setPaused(paused) { this.el('.pause-overlay').hidden = !paused||Boolean(this.mobile?.blocked)||Boolean(this.settingsOpen); this.clearTouch(); }
  setOnline(active) { this.online=Boolean(active);this.el('.leave-race-button').hidden = !active; this.el('.pause-button').hidden = active || this.phase === 'menu' || this.phase === 'finished';this.el('.rotate-status').textContent=active?'联机比赛持续进行，也可先竖屏继续。':'单人比赛已为你暂停。';this.all('[data-action-hint="pause"],[data-action-hint="restart"]').forEach(hint=>{hint.hidden=this.online;});this.updateKeyboardFootnote(); }
  updateKeyboardFootnote() {
    if(!this.bindings)return;
    const text=action=>this.bindings[action].map(keyLabel).join(' / ');
    this.el('.keyboard-help-footnote').textContent=this.online?'联机比赛持续进行；暂停和重新比赛仅在单人模式可用。设置中可自定义电脑键位。':`${text('pause')} 暂停 / 继续 · ${text('restart')} 重新比赛（单人） · 设置中可自定义电脑键位`;
  }
  measureKeyboardHint(){
    for(const [selector,variable] of [['.race-hint','--keyboard-hint-height'],['.menu-footer','--keyboard-menu-height']]){
      const height=this.el(selector).getBoundingClientRect().height;if(height>0)this.root.style.setProperty(variable,`${Math.ceil(height)}px`);
    }
  }
  setKeyBindings(bindings) {
    this.bindings=validateKeyBindings(bindings);
    const labels=action=>{
      const codes=this.bindings[action];
      return codes.length===2&&codes.includes('ShiftLeft')&&codes.includes('ShiftRight')?['Shift']:codes.map(keyLabel);
    };
    const text=action=>labels(action).join(' / ');
    const chips=action=>labels(action).map(label=>`<kbd>${escapeHTML(label)}</kbd>`).join('<i aria-hidden="true">/</i>');
    const guide=KEYBOARD_ACTIONS.map(({id,label})=>`<span class="key-hint" data-action-hint="${id}"${this.online&&['pause','restart'].includes(id)?' hidden':''}>${chips(id)}<span>${escapeHTML(label)}</span></span>`).join('');
    this.el('.keyboard-guide').innerHTML=guide;this.el('.keyboard-guide').setAttribute('aria-label','电脑驾驶键位');
    this.el('.race-hint').innerHTML=guide;this.el('.race-hint').setAttribute('aria-label','电脑驾驶键位');
    this.el('.auto-throttle-button kbd').textContent=text('autoThrottle');
    this.el('.auto-throttle-button').title=`自动油门（${text('autoThrottle')}）`;
    this.el('.nitro-panel small').innerHTML=`${chips('nitro')} 释放加速`;
    this.el('.drift-heading > span:last-child').textContent=text('drift');
    const help=[
      ['throttle','踩下油门',`持续按住 ${text('throttle')} 加速，${text('brake')} 刹车；${text('autoThrottle')} 切换自动油门。`],
      ['left','转向与过弯',`${text('left')} 向左，${text('right')} 向右。草地会让赛车减速。`],
      ['drift','漂移，攒一点惊喜','转弯时按住漂移，蓄力后松开获得加速。'],
      ['nitro','释放晴空氮气','漂移补充能量，按住氮气键提速。'],
      ['useItem','把道具留给好时机','道具赛经过彩色箱子获得一个道具；按道具键使用。竞速赛没有道具。'],
    ];
    this.el('.keyboard-help-list').innerHTML=help.map(([action,title,description])=>`<div><span class="help-keys">${chips(action)}</span><p><strong>${title}</strong><small>${escapeHTML(description)}</small></p></div>`).join('');
    this.updateKeyboardFootnote();
    this.measureKeyboardHint();
  }
  setAutoThrottle(active,remember=true) { this.autoThrottle = !!active; const button = this.el('.auto-throttle-button'); button.classList.toggle('active', this.autoThrottle); button.setAttribute('aria-pressed', this.autoThrottle);if(remember){this.autoThrottleChosen=true;this.callbacks.onAutoThrottleChange?.(this.autoThrottle);} }
  setMuted(muted) { this.muted = !!muted; const button = this.el('.sound-button'); button.classList.toggle('muted', this.muted); button.setAttribute('aria-label', this.muted ? '开启声音' : '关闭声音'); button.title = this.muted ? '开启声音' : '关闭声音'; }
  setDriverTitle(title) { this.driverTitle=title==='晴空杯车手'?title:'';this.el('.driver-motto').textContent=this.driverTitle||chars[this.character].subtitle; }
  setControlLayout(layout) {
    const mirrored=layout==='left-handed',side=mirrored?'右侧':'左侧';
    this.el('.mobile-hint').textContent=mirrored?'横屏更尽兴 · 右手转向，左手漂移与氮气':'横屏更尽兴 · 左手转向，右手漂移与氮气';
    this.el('.touch-hint').textContent=`手机：默认自动油门；${side}左右转向，另一只手按住漂移、松开小喷，⚡ 按住释放氮气。刹车可降低车速；关闭自动油门后按住油门手动驾驶。`;
    this.el('.rotate-card > p').firstChild.textContent=mirrored?'右手转向，左手漂移和氮气。':'左手转向，右手漂移和氮气。';
  }
  showHelp() { this.resumeAfterHelp = this.phase === 'racing' || this.phase === 'countdown'; if (this.resumeAfterHelp) this.callbacks.onPause?.(); this.el('.help-overlay').hidden = false; this.clearTouch(); this.el('.close-help').focus(); }
  hideHelp() { this.el('.help-overlay').hidden = true; if (this.resumeAfterHelp) { this.el('.pause-overlay').hidden = true; this.callbacks.onResume?.(); } this.resumeAfterHelp = false; }
  closeHelp() { this.hideHelp(); }

  showResults(results, best) {
    this.phase = 'finished';
    this.root.classList.remove('in-race');this.mobile?.sync();
    this.hideOverlays();
    this.el('.results-overlay').hidden = false;
    this.el('.touch-controls').hidden = true;
    this.el('.countdown').hidden = true;
    this.clearTouch();
    const rows = Array.isArray(results) ? results : results?.racers || results?.results || [];
    const player = rows.find(r => r.id === this.playerId || r.isPlayer || r.id === 'player' || r.player) || rows[0] || {};
    const time = player.finishTime ?? player.time ?? results?.finishTime ?? 0;
    this.el('.pause-button').hidden = true;
    this.el('.result-time').textContent = player.finished === false ? '未完赛' : timeText(time);
    this.el('.result-best').textContent = best ? timeText(typeof best === 'object' ? best.time : best) : '--:--.--';
    const rank = player.position || rows.indexOf(player) + 1;
    this.el('.result-summary').textContent = player.finished === false ? `比赛结束 · 当前第 ${rank} 名` : `第 ${rank} 名完成${this.track?.name || '晴空大环岛'} · 每一圈都值得喝彩`;
    this.el('.result-list').innerHTML = rows.map((r, i) => `<div class="result-row ${r === player ? 'is-you' : ''}"><span class="result-rank">${r.position || i + 1}</span><span class="result-name">${escapeHTML(r.name || r.characterName || chars[r.character]?.name || `车手 ${i + 1}`)}${r === player ? '<small>你</small>' : ''}</span><span class="result-row-time">${(r.finishTime ?? r.time) != null ? timeText(r.finishTime ?? r.time) : '未完赛'}</span></div>`).join('');
  }

  openLobby() {
    this.el('.lobby-overlay').hidden = false;
    this.el('.room-entry').hidden = false;
    this.el('.room-content').hidden = true;
    this.el('#room-code-input').value = '';
    this.el('.lobby-status').textContent = '创建房间，或输入朋友的房间号';
    this.el('.lobby-description').textContent = `本次目的地：${this.track?.name || '晴空大环岛'} · ${this.raceMode==='items'?'道具赛':'竞速赛'}。分享房间号，邀请朋友一起出发。`;
  }

  showLobby(data = {}) {
    this.room = data;
    this.phase = 'lobby';
    this.root.classList.remove('in-race');this.mobile?.sync();this.el('.countdown').hidden=true;this.el('.pause-button').hidden=true;this.clearTouch();
    this.el('.menu-screen').hidden = true;
    this.el('.race-hud').hidden = true;
    this.el('.touch-controls').hidden = true;
    this.el('.lobby-overlay').hidden = false;
    this.el('.room-entry').hidden = true;
    this.el('.room-content').hidden = false;
    this.el('.room-code').textContent = data.code || '------';
    this.el('.lobby-description').textContent = `比赛赛道：${this.track?.name || '晴空大环岛'} · ${data.laps||3} 圈 · `;
    const modeLabel=document.createElement('strong');modeLabel.className='room-mode';modeLabel.textContent=data.mode==='items'?'道具赛':'竞速赛';this.el('.lobby-description').append(modeLabel);
    const players = data.players || [];
    this.el('.lobby-players').innerHTML = players.map((p, i) => `<div class="lobby-player"><span class="lobby-avatar">${icons[p.character] || foxIcon}</span><span><strong>${escapeHTML(p.name || chars[p.character]?.name || `车手 ${i + 1}`)}</strong><small>${p.connected === false ? '重连中 · AI 暂代' : p.id === data.hostId ? '房主' : '已上车'}${p.id === data.selfId ? ' · 你' : ''}</small></span><span class="player-ready">${p.connected === false ? '◌' : '●'}</span></div>`).join('') + Array.from({ length: Math.max(0, 4 - players.length) }, (_, i) => `<div class="lobby-player empty"><span class="empty-avatar">+</span><span>等一位好朋友<small>没有玩家时由 AI 补齐</small></span></div>`).join('');
    const host = data.hostId === data.selfId;
    this.el('.start-room-button').hidden = !host;
    const connectedPlayers=players.filter(player=>player.connected!==false).length;
    this.el('.start-room-button').disabled = connectedPlayers < 2 || Boolean(this.loading);
    this.el('.start-room-button span').textContent = connectedPlayers < 2 ? '等一位好友上车' : '全员上车，出发！';
    this.el('.waiting-host').hidden = host;
    this.el('.lobby-status').textContent = data.status === 'lobby' || !data.status ? '房间已就绪，分享房间号邀请好友' : data.status;
  }

  setCourse(track) {
    this.track = track;
    this.el('.course-stamp strong').textContent = track.name;
    this.el('.course-stamp > div > small').textContent = track.english || 'SUNSHINE ISLAND';
    this.el('.course-number').textContent = String(['sunny-island','candy-hills','bay-loop','starlight-canyon'].indexOf(track.id)+1).padStart(2,'0');
    this.el('.course-weather').innerHTML = track.id === 'starlight-canyon' ? '✦<small>星夜</small>' : '☀<small>晴朗</small>';
    this.currentZone = null;
    this.el('.edition').textContent = 'VOL. 04';
    this.el('.ready-line .loading-label').textContent = `${(track.length / 1000).toFixed(2)} km / 圈 · ${track.zones?.length || 1} 大区域 · 8 位车手`;
    if (!this.el('.course-zone')) { const zone = document.createElement('span');zone.className='course-zone';this.el('.lap-panel').append(zone); }
    this.updateCourse(0);
  }
  setOverview(active) {
    this.overview=Boolean(active);this.root.classList.toggle('overview-mode',this.overview);
    this.el('.overview-return').hidden=!this.overview;this.callbacks.onOverview?.(this.overview);
  }
  updateCourse(distance) {
    const zone=this.track?.sample(distance).zone;
    if(zone && zone.id!==this.currentZone) {
      this.currentZone=zone.id;this.el('.course-zone').textContent=zone.name;
      this.el('.minimap-panel > span').textContent=`${zone.name} · ${(this.track.length/1000).toFixed(2)} km`;
    }
  }
  setNetwork({ connected, ping, error, message, reconnecting } = {}) {
    const badge = this.el('.network-status');
    badge.hidden = connected === undefined && !error;
    badge.classList.toggle('offline', !connected);
    badge.textContent = error ? '连接中断' : connected ? `● 已连接${Number.isFinite(ping) ? ` · ${Math.round(ping)} ms` : ''}` : reconnecting ? '◌ 正在恢复比赛 · AI 暂代' : '● 正在连接';
    if (error) this.el('.lobby-status').textContent = error;
    else if(message)this.el('.lobby-status').textContent=message;
  }
}

export { timeText };
