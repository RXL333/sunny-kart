import { PHYSICS, curvatureAt, offroadAmount, steeringRate, stepKartPhysics, solveKartCollisions } from './physics.js';
import { ITEMS, ITEM_RULES, chooseItem, createItemBoxes } from './items.js';

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
  drift: Boolean(input?.drift), nitro: Boolean(input?.nitro), useItem: Boolean(input?.useItem),
  itemUseSeq: Number.isSafeInteger(input?.itemUseSeq) && input.itemUseSeq >= 0 ? input.itemUseSeq : undefined,
});

export class Race {
  constructor(track, options = {}) {
    this.track = track;
    this.options = { character: 'fox', difficulty: 'normal', laps: 3, ...options };
    this.laps = clamp(Math.round(this.options.laps), 1, 9);
    this.multiplayer = Boolean(options.multiplayer);
    this.mode = options.mode === 'items' ? 'items' : !this.multiplayer && options.mode === 'time-trial' ? 'time-trial' : 'race';
    this.itemBoxes = this.mode === 'items' ? createItemBoxes(track) : [];
    this.reset();
  }

  reset() {
    this.phase = 'menu'; this.countdown = 3; this.elapsed = 0; this.finishTime = null;
    this.results = []; this.events = []; this.leaderFinishTime = null;
    this.itemObjects = []; this.nextItemObjectId = 0;
    this.itemRandomState = Number.isSafeInteger(this.options.itemSeed) ? this.options.itemSeed >>> 0 : 0x51a77;
    this.disconnectedIds = new Set();
    const humans = this.options.humanPlayers?.length ? this.options.humanPlayers.slice(0, 8) : [{ id: 'player', name: characterFor(this.options.character).name, character: this.options.character }];
    this.humanIds = new Set(humans.map(p => p.id));
    this.racers = Array.from({ length: this.mode === 'time-trial' ? 1 : 8 }, (_, i) => {
      const h = humans[i];
      const character = h?.character || CHARACTERS[i % 3].id;
      return {
        id: h?.id || `ai-${i}`, name: h?.name || AI_NAMES[(i - humans.length + 7) % 7], character,
        color: h ? characterFor(character).color : COLORS[i],
        distance: -(Math.floor(i / 2) * 5.2) || 0, offset: this.mode === 'time-trial' ? 0 : i % 2 ? 2.3 : -2.3,
        speed: 0, lateralVelocity: 0, yaw: 0, yawRate: 0, lap: 1, position: i + 1, boost: 0, driftBoost: 0,
        driftCharge: 0, isDrifting: false, nitro: 55, coins: 0, spin: 0,
        finished: false, finishTime: null, bestDistance: 0,
        aiSkill: 0.97 + Math.sin(i * 2.67) * 0.035, nextPad: {}, collected: {}, collectedLaps: {}, itemCollected: {},
        recovery: 0, nitroActive: false, collisionCooldown: 0,
        shield: 0, magnet: 0, rocket: 0, inventory: null, itemSlow: 0, itemProtection: 0,
        itemUseHeld: false, lastItemUseSeq: 0, itemAiDelay: 0, lapTimes: [], lastLapStartedAt: 0,
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
      if (racer.finished) drive = { ...this.aiInput(racer, i), throttle: 0.65, nitro: false, useItem: false };
      else if (this.disconnectedIds?.has(racer.id)) drive = this.aiInput(racer, i);
      else if (this.humanIds.has(racer.id)) drive = cleanInput(inputsById[racer.id] || (racer.id === this.player.id ? input : {}));
      else drive = this.aiInput(racer, i);
      this.stepRacer(racer, drive, dt);
    }
    if (this.mode === 'items') this.stepItemObjects(dt);
    if (this.mode !== 'time-trial') this.collisions(dt);
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
    const useItem = this.mode === 'items' && !r.finished && r.inventory && !(r.itemAiDelay > 0) && (
      r.inventory === 'magnet' || r.inventory === 'shield' ||
      (r.inventory === 'rocket' && r.speed > 6 && previewCurve < .035) ||
      (r.inventory === 'bubble' && this.racers.some(other => other !== r && !other.finished && this.itemDelta(r, other) > 3 && this.itemDelta(r, other) < 35 && Math.abs(other.offset - r.offset) < 3)) ||
      (r.inventory === 'jelly' && this.racers.some(other => other !== r && !other.finished && this.itemDelta(r, other) < -3 && this.itemDelta(r, other) > -24 && Math.abs(other.offset - r.offset) < 4))
    );
    return { throttle: 1, brake, steer, drift: false, nitro, useItem: Boolean(useItem), speedLimit: cornerSpeed };
  }

  stepRacer(r, input, dt, { prediction = false } = {}) {
    const char = characterFor(r.character), human = this.humanIds.has(r.id);
    const before = r.distance, wasDrifting = r.isDrifting;
    r.boost = Math.max(0, r.boost - dt); r.driftBoost = Math.max(0, r.driftBoost - dt);
    r.spin = Math.max(0, r.spin - dt); r.collisionCooldown = Math.max(0, r.collisionCooldown - dt);
    r.recovery = Math.max(0, r.recovery - dt);
    r.shield = Math.max(0, (r.shield || 0) - dt);
    r.magnet = Math.max(0, (r.magnet || 0) - dt);
    r.rocket = Math.max(0, (r.rocket || 0) - dt);
    r.itemSlow = Math.max(0, (r.itemSlow || 0) - dt);
    r.itemProtection = Math.max(0, (r.itemProtection || 0) - dt);
    if (!prediction) {
      r.itemAiDelay = Math.max(0, (r.itemAiDelay || 0) - dt);
      const sequenced = Number.isSafeInteger(input.itemUseSeq) && input.itemUseSeq >= 0;
      const requested = sequenced ? input.itemUseSeq > (r.lastItemUseSeq || 0) : input.useItem && !r.itemUseHeld;
      if (sequenced) r.lastItemUseSeq = Math.max(r.lastItemUseSeq || 0, input.itemUseSeq);
      r.itemUseHeld = Boolean(input.useItem);
      if (requested && this.mode === 'items' && !r.finished) this.useItem(r);
    }
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
    const boosted = r.nitroActive || r.boost > 0 || r.rocket > 0;
    const aiFactor = human ? 1 : (DIFFICULTIES[this.options.difficulty] || DIFFICULTIES.normal) * r.aiSkill;
    let maxSpeed = 34 * char.speed * aiFactor;
    if (boosted) maxSpeed += r.rocket > 0 ? 16 : 12;
    maxSpeed *= 1 - grass * 0.45;
    if (r.spin) maxSpeed *= 0.55;
    if (r.itemSlow > 0) maxSpeed *= ITEM_RULES.speedFactor;
    if (Number.isFinite(input.speedLimit)) maxSpeed = Math.min(maxSpeed, input.speedLimit);
    const motion = stepKartPhysics(r, input, this.track, dt, { maxSpeed, acceleration: r.rocket > 0 ? 30 : boosted ? 18 : 12.5, handling: char.handling });
    if (motion.railImpact > 1 && !r.recovery && human && !prediction) { this.emit(r.shield > 0 ? 'shieldBlock' : 'bump', r.shield > 0 ? '泡泡护盾挡住擦碰！' : '擦碰护栏，松开转向驶回赛道', { racerId: r.id, impact: motion.railImpact }); r.recovery = 1.2; }
    const oldLap = r.lap;
    if (!prediction) {
      r.bestDistance = Math.max(r.bestDistance, r.distance);
      r.lap = clamp(Math.floor(Math.max(0, r.bestDistance) / this.track.length) + 1, 1, this.laps);
      const previousCompleted = r.lapTimes.length;
      const completed = Math.min(this.laps, Math.floor(Math.max(0, r.bestDistance) / this.track.length));
      for (let lap = previousCompleted; lap < completed; lap++) {
        const line = (lap + 1) * this.track.length;
        const fraction = clamp((line - before) / Math.max(1e-9, r.distance - before), 0, 1);
        const crossedAt = Math.max(r.lastLapStartedAt, this.elapsed - dt + fraction * dt);
        r.lapTimes.push(crossedAt - r.lastLapStartedAt); r.lastLapStartedAt = crossedAt;
      }
    }
    if (r.lap > oldLap && human && !prediction) this.emit('lap', r.lap === this.laps ? '最后一圈！' : `第 ${r.lap} 圈`, { lap: r.lap, racerId: r.id });
    for (const pad of r.finished ? [] : this.track.boostPads || []) {
      if (this.crossed(before, r.distance, pad.distance) && Math.abs(r.offset - pad.lane) < 2.6) {
        r.boost = Math.max(r.boost, 1.4);
        if (human && !prediction) this.emit('boost', '加速带！', { racerId: r.id });
      }
    }
    for (const crystal of prediction || r.finished ? [] : this.track.coins || []) {
      const lap = Math.floor((r.distance - crystal.distance) / this.track.length);
      if (this.crossed(before, r.distance, crystal.distance) && Math.abs(r.offset - crystal.lane) < (r.magnet > 0 ? 8 : 2.2) && lap >= 0 && lap < this.laps && !(r.collectedLaps[crystal.id] >= lap)) {
        const amount = Math.min(8, Math.max(0, 100 - r.nitro));
        r.nitro += amount; r.coins++;
        r.collected[crystal.id] = this.elapsed; r.collectedLaps[crystal.id] = lap;
        if (human) this.emit('energy', amount > 0 ? `能量 +${Number(amount.toFixed(1))}` : '氮气已满', { racerId: r.id, crystalId: crystal.id, lap, amount });
      }
    }
    for (const box of prediction || r.finished || this.mode !== 'items' || r.inventory ? [] : this.itemBoxes) {
      const lap = Math.floor((r.distance - box.distance) / this.track.length);
      if ((!ITEMS[box.type] && box.type !== 'random') || !this.crossed(before, r.distance, box.distance) || Math.abs(r.offset - box.lane) >= 2.6 || lap < 0 || lap >= this.laps || r.itemCollected[box.id] >= lap) continue;
      const type = ITEMS[box.type] ? box.type : chooseItem(r.position, this.racers.length, () => this.itemRandom());
      r.itemCollected[box.id] = lap; r.inventory = type; r.itemAiDelay = .55;
      if (human) this.emit('item', `获得${ITEMS[type].name}，按道具键使用`, { racerId: r.id, itemId: box.id, itemType: type, lap, duration: ITEMS[type].duration });
      break;
    }
    if (!prediction && !r.finished && r.bestDistance >= this.track.length * this.laps) {
      r.finished = true;
      const overshoot = r.distance - this.track.length * this.laps;
      r.finishTime = r.lapTimes.length === this.laps ? r.lastLapStartedAt : Math.max(0, this.elapsed - overshoot / Math.max(0.001, r.speed));
      this.leaderFinishTime ??= this.elapsed;
      if (r.id === this.player.id) this.finishTime = r.finishTime;
      this.clearRacerItems(r);
      this.itemObjects = this.itemObjects.filter(object => object.ownerId !== r.id);
      this.emit('finish', `${r.name} 冲线！`, { racerId: r.id, time: r.finishTime });
    }
  }

  itemRandom() {
    this.itemRandomState = (Math.imul(this.itemRandomState, 1664525) + 1013904223) >>> 0;
    return this.itemRandomState / 0x100000000;
  }

  itemDelta(from, to) {
    const delta = to.distance - from.distance;
    return delta - Math.round(delta / this.track.length) * this.track.length;
  }

  itemPose(entity) {
    const p = this.track.sample(entity.distance), heading = p.heading || 0;
    return { x: (p.x ?? 0) + (p.nx ?? Math.cos(heading)) * entity.offset,
      y: p.y || 0, z: (p.z ?? entity.distance) + (p.nz ?? -Math.sin(heading)) * entity.offset };
  }

  clearRacerItems(r) {
    r.inventory = null;
    for (const key of ['shield', 'magnet', 'rocket', 'itemSlow', 'itemProtection', 'boost', 'driftBoost']) r[key] = 0;
    r.nitroActive = false;
  }

  guideBubble(object, dt) {
    const pose = this.itemPose(object);
    const eligible = r => {
      const ahead = this.itemDelta(object, r);
      if (r.finished || r.id === object.ownerId || ahead <= 0 || ahead > 36 || Math.abs(r.offset - object.offset) > 3.25) return false;
      const target = this.itemPose(r);
      return Math.abs(pose.y - target.y) < 3 && Math.hypot(pose.x - target.x, pose.y - target.y, pose.z - target.z) < 38;
    };
    let target = this.racers.find(r => r.id === object.targetId && eligible(r));
    if (!target) target = this.racers.filter(eligible).sort((a, b) => this.itemDelta(object, a) - this.itemDelta(object, b))[0];
    object.targetId = target?.id || null;
    if (target) object.offset += clamp(target.offset - object.offset, -2.8 * dt, 2.8 * dt);
  }

  useItem(r) {
    if (this.mode !== 'items' || r.finished || !ITEMS[r.inventory]) return false;
    const type = r.inventory, duration = ITEMS[type].duration;
    r.inventory = null;
    if (type === 'bubble' || type === 'jelly') {
      // Keep bandwidth and simulation work bounded even in a packed room.
      if (this.itemObjects.length >= ITEM_RULES.maxObjects) this.itemObjects.shift();
      this.itemObjects.push({ id: `item-object-${++this.nextItemObjectId}`, type, ownerId: r.id,
        distance: r.distance + (type === 'bubble' ? 3.4 : -3.4), offset: r.offset,
        life: duration, speed: type === 'bubble' ? ITEM_RULES.bubbleSpeed : 0 });
    } else r[type] = duration;
    this.emit('itemUse', `${ITEMS[type].name}！`, { racerId: r.id, itemType: type, duration });
    return true;
  }

  hitWithItem(r, object) {
    if (this.mode !== 'items' || r.finished || r.id === object.ownerId || r.itemProtection > 0) return false;
    r.itemProtection = ITEM_RULES.protectionDuration;
    if (r.shield > 0) {
      r.shield = 0;
      this.emit('shieldBlock', '泡泡护盾挡住了道具！', { racerId: r.id, sourceId: object.ownerId, itemType: object.type, objectId: object.id });
      return true;
    }
    // One bounded speed reduction. Steering, drift and orientation remain in
    // the driver's control; subsequent protected hits do not compound it.
    r.speed = Math.max(0, r.speed * ITEM_RULES.speedFactor);
    r.itemSlow = ITEM_RULES.slowDuration;
    this.emit('itemHit', '被道具击中，短暂减速', { racerId: r.id, sourceId: object.ownerId, itemType: object.type, objectId: object.id, duration: ITEM_RULES.slowDuration });
    return true;
  }

  stepItemObjects(dt) {
    if (this.mode !== 'items') return;
    const active = [];
    for (const object of this.itemObjects) {
      object.life -= dt;
      if (object.life <= 0) continue;
      object.distance += (object.speed || 0) * dt;
      if (object.type === 'bubble') this.guideBubble(object, dt);
      const pose = this.itemPose(object);
      let contacted = false;
      for (const r of this.racers) {
        if (r.finished || r.id === object.ownerId || Math.abs(this.itemDelta(object, r)) > 5 || Math.abs(r.offset - object.offset) > 4) continue;
        const target = this.itemPose(r);
        if (Math.hypot(pose.x - target.x, pose.y - target.y, pose.z - target.z) > ITEM_RULES.hitRadius) continue;
        this.hitWithItem(r, object);
        contacted = true;
        break;
      }
      if (!contacted) active.push(object);
    }
    this.itemObjects = active;
  }

  crossed(from, to, point) {
    if (to <= from || to < point) return false;
    return Math.floor((to - point) / this.track.length) > Math.floor((from - point) / this.track.length);
  }

  collisions() {
    const protectedSpeeds = new Map(this.racers.filter(r => r.shield > 0).map(r => [r.id, r.speed]));
    for (const { a, b, impact } of solveKartCollisions(this.racers, this.track)) {
      if (impact < 0.6 || (a.collisionCooldown && b.collisionCooldown)) continue;
      a.collisionCooldown = 0.55; b.collisionCooldown = 0.55;
      for (const r of [a, b]) if (this.humanIds.has(r.id)) this.emit(r.shield > 0 ? 'shieldBlock' : 'bump', r.shield > 0 ? '泡泡护盾挡住碰撞！' : '轻微碰撞', { racerId: r.id, impact });
    }
    // The bubble keeps 85% of momentum otherwise lost to contact. It never
    // exceeds the protected car's approach speed or increases its lateral kick.
    for (const r of this.racers) if (protectedSpeeds.has(r.id)) r.speed += Math.max(0, protectedSpeeds.get(r.id) - r.speed) * .85;
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
    for (const racer of this.racers) this.clearRacerItems(racer);
    this.itemObjects = [];
    this.results = this.rank().map(r => ({ id: r.id, name: r.name, character: r.character, color: r.color, position: r.position, finishTime: r.finishTime, finished: r.finished, distance: r.distance, coins: r.coins }));
    this.finishTime = this.player.finishTime;
    this.emit('results', '比赛结束');
  }
  snapshot() {
    return {
      trackId: this.track.id, mode: this.mode,
      itemBoxes: this.itemBoxes.map(box => ({ ...box })), itemObjects: this.itemObjects.map(object => ({ ...object })),
      itemRandomState: this.itemRandomState, nextItemObjectId: this.nextItemObjectId,
      phase: this.phase, countdown: this.countdown, elapsed: this.elapsed, laps: this.laps,
      finishTime: this.finishTime, results: this.results, playerId: this.player.id,
      humanIds: [...this.humanIds], racers: this.racers.map(r => ({ ...r, nextPad: undefined, collected: { ...r.collected }, collectedLaps: { ...r.collectedLaps }, itemCollected: { ...r.itemCollected }, lapTimes: [...r.lapTimes] })),
      events: this.consumeEvents(),
    };
  }
  applySnapshot(state, localPlayerId = this.player.id) {
    for (const key of ['phase', 'countdown', 'elapsed', 'laps', 'finishTime', 'results', 'mode']) if (state[key] !== undefined) this[key] = state[key];
    this.humanIds = new Set(state.humanIds || []);
    this.itemBoxes = this.mode === 'items' ? (state.itemBoxes || createItemBoxes(this.track)).map(box => ({ ...box })) : [];
    this.itemObjects = this.mode === 'items' ? (state.itemObjects || []).map(object => ({ ...object })) : [];
    if (Number.isSafeInteger(state.itemRandomState)) this.itemRandomState = state.itemRandomState >>> 0;
    if (Number.isSafeInteger(state.nextItemObjectId)) this.nextItemObjectId = state.nextItemObjectId;
    this.racers = state.racers.map(r => ({ ...r, inventory: this.mode === 'items' && ITEMS[r.inventory] ? r.inventory : null,
      itemSlow: r.itemSlow || 0, itemProtection: r.itemProtection || 0, lastItemUseSeq: r.lastItemUseSeq || 0, itemUseHeld: Boolean(r.itemUseHeld),
      collected: { ...r.collected }, collectedLaps: { ...r.collectedLaps }, itemCollected: { ...r.itemCollected }, lapTimes: [...(r.lapTimes || [])] }));
    for (const racer of this.racers) if (racer.finished || this.phase === 'finished') this.clearRacerItems(racer);
    if (this.phase === 'finished') this.itemObjects = [];
    this.player = this.racers.find(r => r.id === localPlayerId) || this.racers[0];
    if (this.player?.finished) this.finishTime = this.player.finishTime;
    this.events.push(...(state.events || []).filter(e => !e.racerId || e.racerId === this.player.id));
  }
}
