import { DRIFT_STAGES } from './game/race.js';

// Local achievements and paint are cosmetic; they never enter vehicle physics.
export const CAREER_KEY = 'sunny-career-v1';
export const CUP_KEY = 'sunny-cup-v1';
export const CUP_TRACKS = Object.freeze(['sunny-island', 'candy-hills', 'bay-loop', 'starlight-canyon']);
export const CUP_POINTS = Object.freeze([10, 8, 6, 5, 4, 3, 2, 1]);
export const CHALLENGES = Object.freeze([
  { id: 'first-finish', name: '向晴空出发', detail: '完成一场正式比赛', reward: '海盐薄荷车漆' },
  { id: 'drift-five', name: '弯道节拍', detail: '一场比赛完成 5 次有效漂移小喷', reward: '落日珊瑚车漆' },
  { id: 'clean-finish', name: '干净漂亮的一圈', detail: '无碰墙、无车辆碰撞完成一场比赛', reward: '星光紫车漆' },
  { id: 'personal-best', name: '超越昨天', detail: '在有旧纪录的计时赛里刷新个人最佳', reward: '晴空金尾焰' },
  { id: 'cup-podium', name: '晴空杯领奖台', detail: '完成四图积分杯并取得总分前三', reward: '晴空杯车贴与称号' },
]);
export const PAINTS = Object.freeze([
  { id: 'original', name: '搭档原色', color: null },
  { id: 'mint', name: '海盐薄荷', color: '#65cfb0', requires: 'first-finish' },
  { id: 'coral', name: '落日珊瑚', color: '#f58b79', requires: 'drift-five' },
  { id: 'violet', name: '星光紫', color: '#ab95e0', requires: 'clean-finish' },
]);
const safeStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
const read = (storage, key) => { try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; } };
const write = (storage, key, value) => { try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const knownBadges = new Set(CHALLENGES.map(c => c.id));

export class Career {
  constructor(storage = safeStorage()) {
    this.storage = storage;
    const saved = read(storage, CAREER_KEY);
    this.badges = new Set(Array.isArray(saved?.badges) ? saved.badges.filter(id => knownBadges.has(id)) : []);
    this.paint = PAINTS.some(p => p.id === saved?.paint && (!p.requires || this.badges.has(p.requires))) ? saved.paint : 'original';
    this.trail = saved?.trail === 'gold' && this.badges.has('personal-best') ? 'gold' : 'original';
    this.title = saved?.title === '晴空杯车手' && this.badges.has('cup-podium') ? saved.title : '';
    this.tutorialDone = saved?.tutorialDone === true;
    this.processed = new WeakSet();
  }
  save() {
    this.persisted = write(this.storage, CAREER_KEY, { badges: [...this.badges], paint: this.paint, trail: this.trail, title: this.title, tutorialDone: this.tutorialDone });
    return this.persisted;
  }
  award(ids) {
    const fresh = ids.filter(id => knownBadges.has(id) && !this.badges.has(id));
    for (const id of fresh) this.badges.add(id);
    this.save();
    return CHALLENGES.filter(c => fresh.includes(c.id));
  }
  finish(race, { personalBest = false, hadGhost = false, practice = false } = {}) {
    if (!race || this.processed.has(race) || practice || race.options?.practice || race.phase !== 'finished' || !race.player?.finished || !['race','items','time-trial'].includes(race.mode)) return [];
    const player=race.player,total=race.track?.length*race.laps;
    if (!Number.isFinite(player.finishTime) || player.finishTime <= 0 || !Number.isInteger(race.laps) || race.laps<1 || race.laps>9 || !Number.isFinite(total) || total<=0 || !Number.isFinite(player.distance) || player.distance<total-.05) return [];
    if (!Array.isArray(player.lapTimes) || player.lapTimes.length!==race.laps || player.lapTimes.some(time=>!Number.isFinite(time)||time<=0) || Math.abs(player.lapTimes.reduce((a,b)=>a+b,0)-player.finishTime)>.05) return [];
    this.processed.add(race);
    const stats = race.player.stats || {};
    return this.award([
      'first-finish',
      ...(Number.isSafeInteger(stats.driftBoosts) && stats.driftBoosts >= 5 ? ['drift-five'] : []),
      ...(stats.clean === true && stats.collisions === 0 && stats.wallHits === 0 ? ['clean-finish'] : []),
      ...(race.mode === 'time-trial' && personalBest && hadGhost ? ['personal-best'] : []),
    ]);
  }
  choose({ paint = this.paint, trail = this.trail, title = this.title } = {}) {
    const option = PAINTS.find(p => p.id === paint);
    if (!option || option.requires && !this.badges.has(option.requires)) return false;
    if (!['original', 'gold'].includes(trail) || trail === 'gold' && !this.badges.has('personal-best')) return false;
    if (title !== '' && (title !== '晴空杯车手' || !this.badges.has('cup-podium'))) return false;
    this.paint = paint; this.trail = trail; this.title = title; this.save(); return true;
  }
  get cosmetics() { return { paint: PAINTS.find(p => p.id === this.paint)?.color || null, trail: this.trail === 'gold' ? '#ffcf68' : null, title: this.title }; }
}

// A cup keeps the same eight seats and awards points once per round.
export class Cup {
  constructor(options = {}, storage = safeStorage()) {
    this.storage = storage;
    if(!options||typeof options!=='object')options={};
    this.options = { character: ['fox', 'rabbit', 'panda'].includes(options.character) ? options.character : 'fox', difficulty: ['easy', 'normal', 'hard'].includes(options.difficulty) ? options.difficulty : 'normal', mode: options.mode === 'items' ? 'items' : 'race' };
    this.round = 0; this.rounds = []; this.scores = []; this.complete = false;this.processed=new WeakSet();
  }
  static load(storage = safeStorage()) {
    const saved = read(storage, CUP_KEY);
    if (!saved || saved.schema !== 1 || !Array.isArray(saved.rounds) || saved.rounds.length > 4 || !saved.options || !['fox','rabbit','panda'].includes(saved.options.character) || !['easy','normal','hard'].includes(saved.options.difficulty) || !['race','items'].includes(saved.options.mode)) return null;
    const cup = new Cup(saved.options, storage);
    // Loading is read-only: a corrupt later round must not overwrite a valid
    // earlier one while the save is being checked.
    for (const rows of saved.rounds) { if (!cup.record(rows,{persist:false})) return null; }
    return cup;
  }
  get trackId() { return CUP_TRACKS[Math.min(this.round, CUP_TRACKS.length - 1)]; }
  record(results,{persist=true}={}) {
    if (this.complete || !Array.isArray(results) || results.length !== 8 || this.processed.has(results) || results.some(r=>!r||typeof r!=='object')) return false;
    const ids = new Set(results.map(r => r.id));
    if (ids.size !== 8 || !ids.has('player') || results.some(r => typeof r.id !== 'string' || !r.id.length || r.id.length>64 || !Number.isInteger(r.position) || r.position < 1 || r.position > 8) || new Set(results.map(r => r.position)).size !== 8) return false;
    if (this.rounds.length && results.some(r => !this.scores.some(s => s.id === r.id))) return false;
    const rows = [...results].sort((a, b) => a.position - b.position).map(r => ({ id: r.id, name: String(r.name || '车手').slice(0, 24), character: r.character, position: r.position, points: CUP_POINTS[r.position - 1] }));
    this.rounds.push(rows);
    for (const row of rows) {
      let score = this.scores.find(s => s.id === row.id);
      if (!score) { score = { id: row.id, name: row.name, points: 0, wins: 0 }; this.scores.push(score); }
      score.points += row.points; if (row.position === 1) score.wins++;
    }
    this.processed.add(results);this.round++; this.complete = this.round === CUP_TRACKS.length;if(persist)this.save();return true;
  }
  standings() { return [...this.scores].sort((a, b) => b.points - a.points || b.wins - a.wins || a.id.localeCompare(b.id)); }
  get playerPosition() { return this.standings().findIndex(s => s.id === 'player') + 1; }
  save() { this.persisted=write(this.storage, CUP_KEY, { schema: 1, options: this.options, rounds: this.rounds });return this.persisted; }
  clear() { try { this.storage?.removeItem(CUP_KEY); } catch {} }
}

export function raceHighlights(race) {
  const stats = race.player?.stats || {};
  const lines = [];
  if (stats.bestDrift >= DRIFT_STAGES.at(-1).threshold) lines.push('完美蓄力 · 漂移高手');
  if (stats.driftBoosts > 0) lines.push(`${stats.driftBoosts} 次漂移小喷`);
  if (stats.overtakes > 0) lines.push(`${stats.overtakes} 次有效超车`);
  if (stats.itemHits > 0) lines.push(`${stats.itemHits} 次道具命中`);
  if (stats.blocks > 0) lines.push(`${stats.blocks} 次护盾防守`);
  if (stats.clean === true && race.player?.finished) lines.push('干净驾驶 · 零碰撞');
  return lines.slice(0, 3);
}

export class DrivingLesson {
  constructor() { this.stage = 0; this.done = false; this.braked = false; this.baselineBoosts = 0; }
  update(race, input = {}) {
    if (this.done || race?.phase !== 'racing' || !race.player) return;
    const p = race.player;
    const brakedBefore=this.braked;
    if (this.stage === 0 && p.speed > 8 && input.brake > .3) this.braked = true;
    if (this.stage === 0 && brakedBefore && !(input.brake>.3) && Math.abs(input.steer) > .3 && p.speed > 5) { this.stage = 1; this.baselineBoosts = p.stats?.driftBoosts || 0; }
    else if (this.stage === 1 && (p.stats?.driftBoosts || 0) > this.baselineBoosts) this.stage = 2;
    else if (this.stage === 2 && p.nitroActive && p.speed > 15 && Math.abs(input.steer||0)<.2 && Math.abs(p.yaw||0)<.3) { this.stage = 3; this.done = true; }
  }
}
