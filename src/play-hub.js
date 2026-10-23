import { CHALLENGES, PAINTS, Cup, CUP_TRACKS, raceHighlights } from './career.js';
import { TRACK_CATALOG } from './game/track.js';
import { keyLabel } from './keyboard-bindings.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const courseName = id => TRACK_CATALOG.find(t => t.id === id)?.name || id;

export class PlayHub {
  constructor(root, career, callbacks = {}) {
    this.root = root; this.career = career; this.callbacks = callbacks; this.tab = 'cup';this.cupMode='race';
    this.button = document.createElement('button'); this.button.className = 'play-hub-button';
    this.button.type = 'button'; this.button.textContent = '★ 晴空杯 · 挑战 · 车库';
    root.querySelector('.menu-footer').append(this.button);
    this.overlay = document.createElement('section'); this.overlay.className = 'overlay play-hub-overlay'; this.overlay.hidden = true;
    this.overlay.innerHTML = '<div class="dialog play-hub-dialog" role="dialog" aria-modal="true" aria-labelledby="play-hub-title"><button class="close-button hub-close" aria-label="关闭玩法与车库">×</button><span class="dialog-eyebrow">ONE MORE SUNNY RIDE</span><h2 id="play-hub-title">下一程，怎么玩？</h2><div class="hub-tabs" role="tablist" aria-label="玩法与车库"><button role="tab" data-hub-tab="cup">晴空杯</button><button role="tab" data-hub-tab="challenges">挑战奖章</button><button role="tab" data-hub-tab="garage">外观车库</button><button role="tab" data-hub-tab="lesson">弯道练习</button></div><div class="hub-content" role="tabpanel"></div><p class="hub-save-note" role="status"></p></div>';
    root.append(this.overlay);
    this.content = this.overlay.querySelector('.hub-content');
    this.button.addEventListener('click', () => this.open());
    this.overlay.querySelector('.hub-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.close(); });
    this.overlay.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      if (e.key === 'Tab') {
        const buttons = [...this.overlay.querySelectorAll('button,select')].filter(b => !b.disabled && !b.closest('[hidden]'));
        if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0].focus(); }
      }
    });
    for (const button of this.overlay.querySelectorAll('[data-hub-tab]')) button.addEventListener('click', () => { this.tab = button.dataset.hubTab; this.render(); });
    this.content.addEventListener('click', e => {
      const action = e.target.closest('[data-hub-action]')?.dataset.hubAction;
      if(action&&this.busy)return;
      if (action === 'cup') { this.close(); callbacks.onCup?.({ mode: this.content.querySelector('[name="cup-mode"]').value }); }
      if (action === 'resume-cup') { this.close(); callbacks.onResumeCup?.(); }
      if (action === 'lesson') { this.close(); callbacks.onLesson?.(); }
      const paint = e.target.closest('[data-paint]')?.dataset.paint;
      if (paint && career.choose({ paint })) { callbacks.onCosmetics?.(career.cosmetics); this.render(); }
    });
    this.content.addEventListener('change', e => {
      if(e.target.matches('[name="cup-mode"]'))this.cupMode=e.target.value==='items'?'items':'race';
      if (e.target.matches('[name="trail"]') && career.choose({ trail: e.target.value })) callbacks.onCosmetics?.(career.cosmetics);
      if (e.target.matches('[name="title"]') && career.choose({ title: e.target.value })) callbacks.onCosmetics?.(career.cosmetics);
      this.render();
    });
    this.results = document.createElement('div'); this.results.className = 'play-results';
    root.querySelector('.results-dialog .result-list').after(this.results);
    this.lessonPanel = document.createElement('div'); this.lessonPanel.className = 'lesson-panel'; this.lessonPanel.hidden = true;
    this.lessonPanel.innerHTML = '<span class="lesson-step"></span><strong class="lesson-title"></strong><p class="lesson-tip"></p><button class="lesson-exit">跳过练习，返回菜单</button>';
    root.append(this.lessonPanel); this.lessonPanel.querySelector('.lesson-exit').addEventListener('click', () => callbacks.onExitLesson?.());
    this.driveFeedback = document.createElement('div'); this.driveFeedback.className = 'drive-feedback'; this.driveFeedback.hidden = true;
    this.driveFeedback.innerHTML = '<span class="route-feedback"></span><span class="draft-feedback"></span><span class="protection-feedback"></span>';
    root.querySelector('.race-hud').append(this.driveFeedback);
    this.warning = document.createElement('div'); this.warning.className = 'attack-warning'; this.warning.hidden = true;
    this.warning.setAttribute('role', 'status'); root.querySelector('.race-hud').append(this.warning);
  }
  open() { this.callbacks.onOpen?.(); this.overlay.hidden = false; this.render(); this.overlay.querySelector('.hub-close').focus(); }
  close() { this.overlay.hidden = true; this.button.focus(); this.callbacks.onClose?.(); }
  setBusy(busy) { this.busy = Boolean(busy); this.button.disabled = this.busy; if (!this.overlay.hidden) this.render(); }
  render() {
    for (const button of this.overlay.querySelectorAll('[data-hub-tab]')) button.setAttribute('aria-selected', String(button.dataset.hubTab === this.tab));
    if (this.tab === 'cup') {
      const saved = Cup.load(this.career.storage);
      this.content.innerHTML = `<p>四张地图，四场比赛，积分决出晴空杯。当前选择的搭档和难度会沿用；竞速杯与道具杯分别开赛。</p><ol class="cup-route">${CUP_TRACKS.map((id, i) => `<li><span>${i + 1}</span>${esc(courseName(id))}</li>`).join('')}</ol><label class="hub-field">比赛类型<select name="cup-mode"><option value="race" ${this.cupMode==='race'?'selected':''}>竞速杯 · 漂移与氮气</option><option value="items" ${this.cupMode==='items'?'selected':''}>道具杯 · 欢乐交手</option></select></label><p class="hub-small">每场 3 圈 · 名次积分 10 / 8 / 6 / 5 / 4 / 3 / 2 / 1 · 退出后可从本场重新开始</p>${saved && !saved.complete ? `<button class="hub-secondary" data-hub-action="resume-cup" ${this.busy ? 'disabled' : ''}>继续上次的杯赛 · 第 ${saved.round + 1} / 4 场</button>` : ''}<button class="primary-button" data-hub-action="cup" ${this.busy ? 'disabled' : ''}>开启一届晴空杯 →</button>`;
    } else if (this.tab === 'challenges') {
      this.content.innerHTML = `<p>把每一程开出自己的目标。完成正式比赛后解锁，练习不计入成绩。</p><div class="challenge-grid">${CHALLENGES.map(c => `<article class="challenge-card ${this.career.badges.has(c.id) ? 'earned' : ''}"><span>${this.career.badges.has(c.id) ? '★ 已获得' : '☆ 待挑战'}</span><strong>${c.name}</strong><p>${c.detail}</p><small>奖励：${c.reward}</small></article>`).join('')}</div>`;
    } else if (this.tab === 'garage') {
      this.content.innerHTML = `<p>车漆、尾焰与称号只改变外观。你的驾驶本领，才是超车的底气。</p><div class="paint-options">${PAINTS.map(p => { const locked = p.requires && !this.career.badges.has(p.requires); return `<button data-paint="${p.id}" ${locked ? 'disabled' : ''} aria-pressed="${this.career.paint === p.id}"><i style="--paint:${p.color || '#20bfae'}"></i><strong>${p.name}</strong><small>${locked ? CHALLENGES.find(c => c.id === p.requires)?.name + ' 解锁' : '已解锁'}</small></button>`; }).join('')}</div><label class="hub-field">尾焰<select name="trail"><option value="original">搭档原色</option><option value="gold" ${this.career.badges.has('personal-best') ? '' : 'disabled'} ${this.career.trail === 'gold' ? 'selected' : ''}>晴空金 · 超越昨天解锁</option></select></label><label class="hub-field">车手称号<select name="title"><option value="">自由追风</option><option value="晴空杯车手" ${this.career.badges.has('cup-podium') ? '' : 'disabled'} ${this.career.title ? 'selected' : ''}>晴空杯车手</option></select></label>`;
    } else {
      this.content.innerHTML = `<p>在没有对手的赛道里，练会三件事：刹车入弯、漂移小喷、氮气超车。按自己的节奏练，随时可以跳过。</p><ol class="lesson-outline"><li><strong>01 入弯</strong><span>先提速，入弯前轻刹，再转向。</span></li><li><strong>02 漂移</strong><span>转弯时按住漂移，看到彩色火花后松开。</span></li><li><strong>03 氮气</strong><span>出弯回正后按住氮气，体验短时突破。</span></li></ol><button class="primary-button" data-hub-action="lesson" ${this.busy?'disabled':''}>进入弯道练习 →</button>`;
    }
    this.overlay.querySelector('.hub-save-note').textContent = this.career.persisted === false ? '本机存储暂不可用，本次奖励仍会保留到关闭页面。' : '奖章和外观自动保存在当前浏览器。';
  }
  showResults(race, cup, awards = []) {
    const highlights = raceHighlights(race);
    this.results.innerHTML = `${this.career.title?'<p class="equipped-title">★ 晴空杯车手</p>':''}${highlights.length ? `<div class="race-highlights">${highlights.map(h => `<span>${esc(h)}</span>`).join('')}</div>` : ''}${awards.length ? `<p class="new-awards">★ 新奖章：${awards.map(a => esc(a.name)).join(' · ')}</p>` : ''}${cup ? `<div class="cup-results"><strong>${cup.complete ? `晴空杯完成 · 总分第 ${cup.playerPosition} 名` : `晴空杯 · 已完成 ${cup.round} / 4 场`}</strong><div>${cup.standings().map((s, i) => `<p class="${s.id === 'player' ? 'is-you' : ''}"><span>${i + 1}. ${esc(s.name)}</span><b>${s.points} 分</b></p>`).join('')}</div>${cup.complete ? '' : `<small>下一站：${esc(courseName(cup.trackId))}</small>`}</div>` : ''}`;
    const button = this.root.querySelector('.results-dialog .restart-button span');
    if (button) button.textContent = cup ? cup.complete ? '再开一届晴空杯' : '下一站，继续争杯' : '再来一场';
  }
  update(race, { lesson, bindings, inputMode, threat } = {}) {
    const active = ['racing', 'countdown', 'paused'].includes(race.phase);
    this.lessonPanel.hidden = !lesson || !active;
    this.root.classList.toggle('in-lesson', Boolean(lesson));
    if (lesson && active) {
      const key = action => inputMode === 'touch' ? ({ throttle:'加速',brake: '刹车', left: '方向键', drift: '漂移', nitro: '⚡ 氮气' })[action] : (action==='left'?[...(bindings?.left||[]),...(bindings?.right||[])]:bindings?.[action] || []).map(keyLabel).join(' / ');
      const lessons = [
        ['刹车入弯', `先${inputMode==='touch'?'加速（也可用自动油门）':`按 ${key('throttle')} 加速`}，再按 ${key('brake')} 轻刹，松开后用 ${key('left')} 转向。`],
        ['漂移出弯', `速度起来后，转弯时按住 ${key('drift')}；出现彩色蓄力后松开。`],
        ['氮气突破', `出弯回正，按住 ${key('nitro')}，让速度再上一档。`],
        ['已经掌握，去追风吧！', '你学会了入弯、漂移与氮气。可以继续自由练习，或返回菜单。'],
      ];
      const current = lessons[Math.max(0,Math.min(3,lesson.stage||0))];
      this.lessonPanel.querySelector('.lesson-step').textContent = lesson.done ? '练习完成 ✓' : `驾驶练习 ${lesson.stage + 1} / 3`;
      this.lessonPanel.querySelector('.lesson-title').textContent = current[0];
      this.lessonPanel.querySelector('.lesson-tip').textContent = current[1];
      this.lessonPanel.querySelector('.lesson-exit').textContent = lesson.done ? '完成练习，返回菜单' : '跳过练习，返回菜单';
    }
    const p = race.player, route = race.track.strategyAt?.(p.distance, p.offset);
    this.driveFeedback.hidden = !active;
    this.driveFeedback.querySelector('.route-feedback').textContent = route ? `${route.label} · ${route.nitroRate > 0 ? '补能，车速稍缓' : p.strategyActive?'耗能，车速更快':'氮气不足，恢复普通速度'}` : '';
    this.driveFeedback.querySelector('.draft-feedback').textContent = p.draftBoost > 0 ? '↟ 尾流突破！' : p.draftCharge > .08 ? `≈ 跟车蓄势 ${Math.round(p.draftCharge * 100)}%` : '';
    this.driveFeedback.querySelector('.protection-feedback').textContent = p.itemProtection > 0 ? '◉ 受击保护中' : '';
    this.warning.hidden = !active || !threat;
    if (threat) this.warning.textContent = `${threat.direction === 'rear' || threat.direction === 'behind' ? '▼ 后方' : '▲ 前方'} ${threat.type === 'jelly' ? '果冻陷阱 · 留意路线' : '泡泡接近 · 变线或护盾'}`;
  }
}
