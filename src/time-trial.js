import { ghostDeltaAt } from './ghost.js';

export function trialTime(value) {
  if (!Number.isFinite(value) || value < 0) return '--:--.--';
  const centiseconds = Math.round(value * 100), minutes = Math.floor(centiseconds / 6000);
  return `${String(minutes).padStart(2, '0')}:${((centiseconds % 6000) / 100).toFixed(2).padStart(5, '0')}`;
}

// This view adds no input shortcuts: it uses the game's existing keyboard,
// pause, touch and restart controls. A native button keeps the entry accessible.
export class TimeTrialUI {
  constructor(root, { onStart = () => {} } = {}) {
    this.root = root;
    const document = root.ownerDocument;
    this.button = document.createElement('button');
    this.button.className = 'time-trial-button';
    this.button.type = 'button';
    this.button.innerHTML = '<span class="time-trial-icon" aria-hidden="true">⏱</span><span>计时挑战</span>';
    this.button.setAttribute('aria-label', '计时挑战');
    this.button.title = '单车三圈，挑战自己的最佳幽灵；没有 AI 或随机道具';
    this.button.addEventListener('click', onStart);
    root.querySelector('.start-actions')?.append(this.button);
    this.panel = document.createElement('section');
    this.panel.className = 'time-trial-panel';
    this.panel.setAttribute('aria-label', '个人计时挑战');
    this.panel.hidden = true;
    this.panel.innerHTML = '<span class="trial-caption">个人计时 · 三圈挑战</span><strong class="trial-delta">首次挑战</strong><span class="trial-reference">完成比赛，留下你的幽灵</span><span class="trial-lap">本圈 00:00.00</span><span class="trial-lap-feedback" role="status"></span>';
    root.querySelector('.race-hud')?.append(this.panel);
    this.result = document.createElement('div');
    this.result.className = 'time-trial-result'; this.result.hidden = true;
    root.querySelector('.result-stat-row')?.after(this.result);
    this.fields = Object.fromEntries(['delta', 'reference', 'lap', 'lap-feedback'].map(name => [name, this.panel.querySelector(`.trial-${name}`)]));
    this.active = false; this.lastUpdate = -Infinity; this.lapCount = 0;
  }
  begin(meta, best = null) {
    this.active = true; this.meta = meta; this.best = best; this.lastUpdate = -Infinity; this.lapCount = 0;
    this.root.classList.add('time-trial-active'); this.panel.hidden = false; this.result.hidden = true;
    this.panel.querySelector('.trial-caption').textContent = `个人计时 · ${meta.laps ?? 3} 圈挑战`;
    this.fields['lap-feedback'].textContent = '';
    delete this.fields.delta.dataset.ahead;
    this.fields.delta.textContent = best ? '等待发车' : '首次挑战';
    this.fields.reference.textContent = best ? `个人最佳 ${trialTime(best.time)} · 追上半透明幽灵` : '完成比赛，留下你的幽灵';
    this.fields.lap.textContent = '本圈 00:00.00';
  }
  update(race, best = this.best) {
    if (!this.active || race.mode !== 'time-trial') return;
    this.panel.hidden = !['countdown', 'racing', 'paused'].includes(race.phase);
    if (race.phase !== 'racing' || race.elapsed - this.lastUpdate < 0.1) return;
    this.lastUpdate = race.elapsed;
    const delta = best ? ghostDeltaAt(best, race.player.distance, race.elapsed) : null;
    this.fields.delta.textContent = delta === null ? (best ? '追逐你的最佳' : '首次挑战') : `${delta < 0 ? '领先' : '落后'} ${Math.abs(delta).toFixed(2)} 秒`;
    this.fields.delta.dataset.ahead = delta !== null && delta < 0 ? 'true' : 'false';
    const times = race.player.lapTimes ?? [];
    const lapTime = Math.max(0, race.elapsed - (race.player.lastLapStartedAt ?? times.reduce((a, b) => a + b, 0)));
    const bestLap = times.length ? Math.min(...times) : null;
    this.fields.lap.textContent = `本圈 ${trialTime(lapTime)}${bestLap === null ? '' : ` · 最快 ${trialTime(bestLap)}`}`;
    if (times.length > this.lapCount) this.fields['lap-feedback'].textContent = `第 ${times.length} 圈 ${trialTime(times.at(-1))}`;
    this.lapCount = times.length;
  }
  finish({ race, saveResult } = {}) {
    if (!this.active || race?.mode !== 'time-trial') return;
    this.panel.hidden = true; this.result.hidden = false; this.result.replaceChildren();
    const document = this.root.ownerDocument, message = document.createElement('p');
    const reason = saveResult?.reason;
    message.textContent = reason === 'best' ? '新的个人最佳！幽灵已保存，下次来超越自己。' : reason === 'slower' ? '挑战完成！最快幽灵已保留，再试一条更漂亮的路线。' : reason === 'storage' ? '挑战完成！浏览器未能保存幽灵，本次成绩仍然有效。' : '挑战完成！本次轨迹未保存，重开可继续挑战。';
    this.result.append(message);
    const times = race.player?.lapTimes ?? [];
    if (times.length) {
      const list = document.createElement('ol'); list.setAttribute('aria-label', '每圈用时');
      for (const [i, time] of times.entries()) { const li = document.createElement('li'); li.textContent = `第 ${i + 1} 圈 ${trialTime(time)}`; list.append(li); }
      this.result.append(list);
    }
    const summary = this.root.querySelector('.result-summary');
    if (summary) summary.textContent = `${race.track?.name ?? '赛道'} · 个人三圈计时挑战`;
  }
  reset() {
    this.active = false; this.best = null; this.panel.hidden = true; this.result.hidden = true;
    this.root.classList.remove('time-trial-active');
  }
  setBusy(busy) { this.button.disabled = Boolean(busy); }
}
