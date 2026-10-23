import { TRACK_CATALOG } from './game/track.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class PartyUI {
  constructor(root, callbacks = {}) {
    this.root = root; this.callbacks = callbacks;
    this.config = document.createElement('div'); this.config.className = 'party-room-config'; this.config.hidden = true;
    this.config.innerHTML = `<label>下一站<select name="party-track">${TRACK_CATALOG.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select></label><label>比赛类型<select name="party-mode"><option value="race">竞速赛</option><option value="items">道具赛</option></select></label><label>圈数<select name="party-laps"><option value="1">1 圈 · 快速赛</option><option value="3">3 圈 · 标准赛</option><option value="5">5 圈 · 耐力赛</option></select></label><label>AI 难度<select name="party-difficulty"><option value="easy">轻松追风</option><option value="normal">标准竞逐</option><option value="hard">高手挑战</option></select></label>`;
    root.querySelector('.room-tip').before(this.config);
    this.config.addEventListener('change', () => callbacks.configure?.({ trackId: this.config.querySelector('[name="party-track"]').value, mode: this.config.querySelector('[name="party-mode"]').value, laps: Number(this.config.querySelector('[name="party-laps"]').value), difficulty: this.config.querySelector('[name="party-difficulty"]').value }));
    this.lobbyVotes = document.createElement('div'); this.lobbyVotes.className = 'party-lobby-votes'; this.lobbyVotes.hidden = true;
    this.lobbyVotes.innerHTML = '<strong>一起投票，选下一站</strong><div class="party-vote-buttons"></div><p class="party-next" aria-live="polite"></p><button class="party-lobby-settings-button" hidden>调整房间设置</button>';
    this.config.after(this.lobbyVotes);
    this.panel = document.createElement('div'); this.panel.className = 'party-panel'; this.panel.hidden = true;
    this.panel.innerHTML = '<strong>队伍已保留 · 投票选下一站</strong><div class="party-vote-buttons"></div><p class="party-next"></p><button class="party-lobby-button">返回房间，调整比赛</button>';
    root.querySelector('.results-dialog .result-list').after(this.panel);
    this.panel.addEventListener('click', e => { const trackId = e.target.closest('[data-vote-track]')?.dataset.voteTrack; if (trackId) callbacks.vote?.(trackId); });
    this.lobbyVotes.addEventListener('click', e => { const trackId = e.target.closest('[data-vote-track]')?.dataset.voteTrack; if (trackId) callbacks.vote?.(trackId); });
    this.lobbyVotes.querySelector('.party-lobby-settings-button').addEventListener('click', () => callbacks.lobby?.());
    this.panel.querySelector('.party-lobby-button').addEventListener('click', () => callbacks.lobby?.());
    this.spectator = document.createElement('div'); this.spectator.className = 'spectator-controls'; this.spectator.hidden = true;
    this.spectator.innerHTML = '<button data-spectate="-1" aria-label="观战上一位车手">←</button><span></span><button data-spectate="1" aria-label="观战下一位车手">→</button>';
    root.append(this.spectator);
    this.spectator.addEventListener('click', e => { const direction = e.target.closest('[data-spectate]')?.dataset.spectate; if (direction) { this.index += Number(direction); callbacks.clear?.(); } });
    this.index = 0;
  }
  room(room, selfId) {
    this.current = room; this.selfId = selfId;
    const host = room?.hostId === selfId;
    const resultsVisible = !this.root.querySelector('.results-overlay').hidden;
    this.config.hidden = !host || room?.status !== 'lobby';
    if (room) {
      this.config.querySelector('[name="party-track"]').value = room.trackId;
      this.config.querySelector('[name="party-mode"]').value = room.mode;
      this.config.querySelector('[name="party-laps"]').value = String(room.laps || 3);
      this.config.querySelector('[name="party-difficulty"]').value = room.difficulty || 'normal';
    }
    this.lobbyVotes.hidden = !room || !(room.status === 'lobby' || room.status === 'finished' && !resultsVisible);
    this.panel.hidden = room?.status !== 'finished';
    if (this.panel.hidden && this.lobbyVotes.hidden) return;
    const votes = room.trackVotes || {}, counts = room.trackVoteCounts || {};
    for (const panel of [this.panel, this.lobbyVotes]) {
      panel.querySelector('.party-vote-buttons').innerHTML = TRACK_CATALOG.map(t => `<button data-vote-track="${t.id}" aria-pressed="${votes[selfId] === t.id}">${esc(t.name)} · ${counts[t.id] || 0} 票</button>`).join('');
      panel.querySelector('.party-next').textContent = `下一站：${TRACK_CATALOG.find(t => t.id === room.nextTrackId)?.name || TRACK_CATALOG.find(t => t.id === room.trackId)?.name || '当前赛道'} · ${host ? '由你开始比赛，平票按赛道顺序决定' : '等待房主开赛，平票按赛道顺序决定'}`;
    }
    this.lobbyVotes.querySelector('.party-lobby-settings-button').hidden = !host || room.status !== 'finished';
    this.panel.querySelector('.party-lobby-button').hidden = !host;
    if (this.panel.hidden) return;
    const restart = this.root.querySelector('.results-dialog .restart-button');
    const ready = (room.players || []).filter(player => player.connected !== false).length >= 2;
    restart.disabled = !host || !ready; restart.querySelector('span').textContent = host ? ready ? '队伍就绪，再来一场' : '等一位好友重新上车' : '等待房主开始下一场';
  }
  reset() { this.current = null; this.panel.hidden = true; this.lobbyVotes.hidden = true; this.config.hidden = true; this.spectator.hidden = true; this.index = 0; this.wasSpectating = false; this.root.classList.remove('is-spectating'); this.root.querySelector('.results-dialog .restart-button').disabled = false; }
  update(race, online) {
    const active = online && race.player.finished && race.phase === 'racing';
    const controls = this.root.querySelector('.touch-controls');
    if (active) { controls.hidden = true; if (!this.wasSpectating) this.callbacks.clear?.(); }
    else if (this.wasSpectating && online && ['racing', 'countdown'].includes(race.phase)) controls.hidden = false;
    this.wasSpectating = active; this.root.classList.toggle('is-spectating', active);
    this.spectator.hidden = !active;
    if (!active) return null;
    const others = race.racers.filter(r => r.id !== race.player.id && !r.finished);
    if (!others.length) { this.spectator.hidden = true; return null; }
    this.index = ((this.index % others.length) + others.length) % others.length;
    const target = others[this.index];
    this.spectator.querySelector('span').textContent = `已冲线 · 观战 ${target.name}`;
    return target;
  }
}
