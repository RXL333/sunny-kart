import { PHYSICS, curvatureAt, offroadAmount, steeringRate, stepKartPhysics, solveKartCollisions } from './physics.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const wrap = (a, n) => ((a % n) + n) % n;
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const COLORS = ['#20bfae', '#ffba45', '#fa7786', '#8779da', '#62bfea', '#f17942', '#a8cf68', '#da80c0'];
const AI_NAMES = ['柠檬汽水', '草莓团子', '云朵队长', '橘子泡泡', '薄荷小熊', '椰椰同学', '星星快跑'];
export const CHARACTERS = [
  { id: 'fox', name: '阿橘', title: '全能小狐狸', speed: 1, handling: 1, nitro: 1, color: '#20bfae' },
  { id: 'rabbit', name: '薄荷', title: '灵巧小兔', speed: 0.97, handling: 1.18, nitro: 1.07, color: '#88c58d' },
  { id: 'panda', name: '波波', title: '稳健小熊猫', speed: 1.035, handling: 0.9, nitro: 0.96, color: '#9d88d3' },
];
const characterFor = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
const DIFFICULTIES = { easy: 0.84, normal: 0.94, hard: 1.025 };
const cleanInput = input => ({
  throttle: clamp(finite(Number(input?.throttle)), 0, 1),
  brake: clamp(finite(Number(input?.brake)), 0, 1),
  steer: clamp(finite(Number(input?.steer)), -1, 1),
  drift: Boolean(input?.drift), nitro: Boolean(input?.nitro || input?.useItem),
});

export class Race {
  constructor(track, options = {}) {
    this.track = track;
    this.options = { character: 'fox', difficulty: 'normal', laps: 3, ...options };
    this.laps = clamp(Math.round(this.options.laps), 1, 9);
    this.multiplayer = Boolean(options.multiplayer);
    this.reset();
  }

  reset() {
    this.phase = 'menu'; this.countdown = 3; this.elapsed = 0; this.finishTime = null;
    this.results = []; this.events = []; this.leaderFinishTime = null;
    const humans = this.options.humanPlayers?.length ? this.options.humanPlayers.slice(0, 8) : [{ id: 'player', name: characterFor(this.options.character).name, character: this.options.character }];
    this.humanIds = new Set(humans.map(p => p.id));
    this.racers = Array.from({ length: 8 }, (_, i) => {
      const h = humans[i];
      const character = h?.character || CHARACTERS[i % 3].id;
      return {
        id: h?.id || `ai-${i}`, name: h?.name || AI_NAMES[(i - humans.length + 7) % 7], character,
        color: h ? characterFor(character).color : COLORS[i],
        distance: -(Math.floor(i / 2) * 5.2) || 0, offset: i % 2 ? 2.3 : -2.3,
        speed: 0, lateralVelocity: 0, yaw: 0, yawRate: 0, lap: 1, position: i + 1, boost: 0, driftBoost: 0,
        driftCharge: 0, isDrifting: false, nitro: 55, coins: 0, spin: 0,
        finished: false, finishTime: null, bestDistance: 0,
        aiSkill: 0.97 + Math.sin(i * 2.67) * 0.035, nextPad: {}, collected: {},
        recovery: 0, nitroActive: false, collisionCooldown: 0,
      };
    });
    this.player = this.racers.find(r => r.id === this.options.localPlayerId) || this.racers[0];
    this.rank();
  }

  start() {
    if (this.phase === 'menu' || this.phase === 'finished') {
      if (this.phase === 'finished') this.reset();
      this.phase = 'countdown'; this.countdown = 3;
      this.emit('countdown', '3');
    }
  }
  restart() { this.reset(); this.start(); }
  pause() { if (this.phase === 'racing' || this.phase === 'countdown') { this.resumePhase = this.phase; this.phase = 'paused'; } }
  resume() { if (this.phase === 'paused') this.phase = this.resumePhase || 'racing'; }
  emit(type, text, extra = {}) { this.events.push({ type, text, ...extra }); }
  consumeEvents() { return this.events.splice(0); }

  update(dt, input = {}, inputsById = {}) {
    dt = clamp(finite(dt), 0, 0.1);
    if (!dt) return;
    const steps = Math.ceil(dt / PHYSICS.fixedStep);
    const step = dt / steps;
    for (let i = 0; i < steps; i++) this.simulateStep(step, input, inputsById);
  }

  simulateStep(dt, input, inputsById) {
    if (!dt || this.phase === 'menu' || this.phase === 'paused' || this.phase === 'finished') return;
    if (this.phase === 'countdown') {
      const prev = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (this.countdown <= 0) { this.countdown = 0; this.phase = 'racing'; this.emit('go', '出发！'); }
      else if (Math.ceil(this.countdown) !== prev) this.emit('countdown', String(Math.ceil(this.countdown)));
      return;
    }
    this.elapsed += dt;
    for (let i = 0; i < this.racers.length; i++) {
      const racer = this.racers[i];
      let drive;
      if (racer.finished) drive = { ...this.aiInput(racer, i), throttle: 0.65, nitro: false };
      else if (this.humanIds.has(racer.id)) drive = cleanInput(inputsById[racer.id] || (racer.id === this.player.id ? input : {}));
      else drive = this.aiInput(racer, i);
      this.stepRacer(racer, drive, dt);
    }
    this.collisions(dt);
    this.rank();
    const done = this.multiplayer
      ? [...this.humanIds].every(id => this.racers.find(r => r.id === id)?.finished) || (this.leaderFinishTime !== null && this.elapsed - this.leaderFinishTime > 30)
      : this.player.finished;
    if (done) this.finish();
  }

  aiInput(r, index) {
    const char = characterFor(r.character);
    const lane = Math.sin(r.distance * 0.003 + index * 2) * 2.25;
    const curvature = curvatureAt(this.track, r.distance + Math.max(3, r.speed * 0.22));
    const previewCurve = Math.max(...[0, 14, 28, 45].map(ahead => Math.abs(curvatureAt(this.track, r.distance + ahead))));
    const desiredYaw = clamp((lane - r.offset) * 0.065 - (r.lateralVelocity || 0) * 0.035, -0.28, 0.28);
    const desiredRate = curvature * r.speed / clamp(1 - curvature * r.offset, 0.6, 1.4) + (desiredYaw - r.yaw) * 2.8;
    const rateLimit = steeringRate(Math.max(4, r.speed), char.handling);
    const steer = clamp(desiredRate / Math.max(0.01, rateLimit), -1, 1);
    const cornerSpeed = Math.min(36, Math.sqrt(19 / Math.max(0.001, previewCurve)), 1.25 / Math.max(0.001, previewCurve));
    const brake = clamp((r.speed - cornerSpeed - 0.5) * 0.09, 0, 0.8);
    const nitro = previewCurve < 0.018 && Math.abs(r.offset) < 5 && r.nitro > 20 && (Math.sin(r.distance * 0.017 + index) > 0.7 || (r.position > 4 && r.nitro > 75));
    return { throttle: 1, brake, steer, drift: false, nitro, speedLimit: cornerSpeed };
  }

  stepRacer(r, input, dt) {
    const char = characterFor(r.character), human = this.humanIds.has(r.id);
    const before = r.distance, wasDrifting = r.isDrifting;
    r.boost = Math.max(0, r.boost - dt); r.driftBoost = Math.max(0, r.driftBoost - dt);
    r.spin = Math.max(0, r.spin - dt); r.collisionCooldown = Math.max(0, r.collisionCooldown - dt);
    r.recovery = Math.max(0, r.recovery - dt);
    const grass = offroadAmount(this.track, r.offset);
    const offroad = grass > 0.65;
    r.offroad = offroad;
    r.isDrifting = input.drift && Math.abs(input.steer) > 0.15 && r.speed > 11 && !offroad && !r.finished;
    if (r.isDrifting) {
      r.driftCharge = Math.min(1, r.driftCharge + dt * (0.47 + Math.abs(input.steer) * 0.2));
      if (!wasDrifting && human) this.emit('drift', '漂移蓄力', { racerId: r.id });
    } else if (wasDrifting) {
      if (r.driftCharge >= 0.24) {
        const charge = r.driftCharge;
        r.boost = Math.max(r.boost, 0.55 + charge * 1.35);
        r.driftBoost = r.boost;
        r.nitro = Math.min(100, r.nitro + 12 + charge * 24);
        if (human) this.emit('driftBoost', charge > 0.8 ? '完美漂移！氮气 +36' : '漂移加速！', { racerId: r.id, charge });
      }
      r.driftCharge = 0;
    } else r.driftCharge = Math.max(0, r.driftCharge - dt * 0.5);

    r.nitroActive = input.nitro && r.nitro > 0 && r.speed > 5 && !offroad && !r.finished;
    if (r.nitroActive) r.nitro = Math.max(0, r.nitro - dt * 24 / char.nitro);
    const boosted = r.nitroActive || r.boost > 0;
    const aiFactor = human ? 1 : (DIFFICULTIES[this.options.difficulty] || DIFFICULTIES.normal) * r.aiSkill;
    let maxSpeed = 34 * char.speed * aiFactor;
    if (boosted) maxSpeed += 12;
    maxSpeed *= 1 - grass * 0.45;
    if (r.spin) maxSpeed *= 0.55;
    if (Number.isFinite(input.speedLimit)) maxSpeed = Math.min(maxSpeed, input.speedLimit);
    const motion = stepKartPhysics(r, input, this.track, dt, { maxSpeed, acceleration: boosted ? 18 : 12.5, handling: char.handling });
    if (motion.railImpact > 1 && !r.recovery && human) { this.emit('bump', '擦碰护栏，松开转向驶回赛道', { racerId: r.id, impact: motion.railImpact }); r.recovery = 1.2; }
    r.bestDistance = Math.max(r.bestDistance, r.distance);
    const oldLap = r.lap;
    r.lap = clamp(Math.floor(Math.max(0, r.bestDistance) / this.track.length) + 1, 1, this.laps);
    if (r.lap > oldLap && human) this.emit('lap', r.lap === this.laps ? '最后一圈！' : `第 ${r.lap} 圈`, { lap: r.lap, racerId: r.id });
    for (const pad of this.track.boostPads) {
      if (this.crossed(before, r.distance, pad.distance) && Math.abs(r.offset - pad.lane) < 2.6) {
        r.boost = Math.max(r.boost, 1.4);
        if (human) this.emit('boost', '加速带！', { racerId: r.id });
      }
    }
    for (const crystal of this.track.coins) {
      if (this.crossed(before, r.distance, crystal.distance) && Math.abs(r.offset - crystal.lane) < 2.2) {
        r.nitro = Math.min(100, r.nitro + 8); r.coins++;
        r.collected[crystal.id] = this.elapsed;
        if (human) this.emit('energy', '能量 +8', { racerId: r.id, crystalId: crystal.id });
      }
    }
    if (!r.finished && r.bestDistance >= this.track.length * this.laps) {
      r.finished = true;
      const overshoot = r.distance - this.track.length * this.laps;
      r.finishTime = Math.max(0, this.elapsed - overshoot / Math.max(0.001, r.speed));
      this.leaderFinishTime ??= this.elapsed;
      if (r.id === this.player.id) this.finishTime = r.finishTime;
      this.emit('finish', `${r.name} 冲线！`, { racerId: r.id, time: r.finishTime });
    }
  }

  crossed(from, to, point) {
    if (to <= from || to < point) return false;
    return Math.floor((to - point) / this.track.length) > Math.floor((from - point) / this.track.length);
  }

  collisions() {
    for (const { a, b, impact } of solveKartCollisions(this.racers, this.track)) {
      if (impact < 0.6 || (a.collisionCooldown && b.collisionCooldown)) continue;
      a.collisionCooldown = 0.55; b.collisionCooldown = 0.55;
      for (const r of [a, b]) if (this.humanIds.has(r.id)) this.emit('bump', '轻微碰撞', { racerId: r.id, impact });
    }
  }

  rank() {
    const sorted = [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.distance - a.distance;
    });
    sorted.forEach((r, i) => { r.position = i + 1; });
    return sorted;
  }
  finish() {
    this.phase = 'finished';
    this.results = this.rank().map(r => ({ id: r.id, name: r.name, character: r.character, color: r.color, position: r.position, finishTime: r.finishTime, finished: r.finished, distance: r.distance, coins: r.coins }));
    this.finishTime = this.player.finishTime;
    this.emit('results', '比赛结束');
  }
  snapshot() {
    return {
      trackId: this.track.id,
      phase: this.phase, countdown: this.countdown, elapsed: this.elapsed, laps: this.laps,
      finishTime: this.finishTime, results: this.results, playerId: this.player.id,
      humanIds: [...this.humanIds], racers: this.racers.map(r => ({ ...r, nextPad: undefined })),
      events: this.consumeEvents(),
    };
  }
  applySnapshot(state, localPlayerId = this.player.id) {
    for (const key of ['phase', 'countdown', 'elapsed', 'laps', 'finishTime', 'results']) if (state[key] !== undefined) this[key] = state[key];
    this.humanIds = new Set(state.humanIds || []);
    this.racers = state.racers.map(r => ({ ...r }));
    this.player = this.racers.find(r => r.id === localPlayerId) || this.racers[0];
    if (this.player?.finished) this.finishTime = this.player.finishTime;
    this.events.push(...(state.events || []).filter(e => !e.racerId || e.racerId === this.player.id));
  }
}
