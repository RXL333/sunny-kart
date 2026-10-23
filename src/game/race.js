import { PHYSICS, curvatureAt, offroadAmount, steeringRate, stepKartPhysics, solveKartCollisions } from './physics.js';
import { ITEMS, ITEM_RULES, chooseItem, createItemBoxes, itemThreatFor } from './items.js';

export const DRIFT_STAGES = Object.freeze([
  Object.freeze({ stage: 1, threshold: .24, duration: .8, nitro: 14, label: '蓝焰', color: '#68d7ff' }),
  Object.freeze({ stage: 2, threshold: .55, duration: 1.3, nitro: 24, label: '金焰', color: '#ffc65d' }),
  Object.freeze({ stage: 3, threshold: .85, duration: 1.9, nitro: 36, label: '紫焰', color: '#d59aff' }),
]);
export const driftStageFor = charge => DRIFT_STAGES.filter(s => charge >= s.threshold).length;
export const AI_PERSONALITIES = Object.freeze({ steady: '稳健车手', defensive: '防守车手', drifter: '漂移进攻手' });
const newStats = () => ({ bestDrift: 0, driftBoosts: 0, overtakes: 0, itemHits: 0, blocks: 0, collisions: 0, wallHits: 0, clean: true, draftBoosts: 0 });

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
    this.passStates = {};
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
        driftCharge: 0, driftStage: 0, isDrifting: false, nitro: 55, coins: 0, spin: 0,
        draftCharge: 0, draftBoost: 0, draftCooldown: 0, drafting: false, draftTargetId: null,
        personality: ['steady', 'defensive', 'drifter'][i % 3], aiDriftCooldown: 0, stats: newStats(),
        strategyId: null, strategyLabel: '', strategyActive: false, strategySpeedFactor: 1, strategyRewards: {},
        finished: false, finishTime: null, bestDistance: 0,
        aiSkill: 0.97 + Math.sin(i * 2.67) * 0.035, nextPad: {}, collected: {}, collectedLaps: {}, itemCollected: {},
        recovery: 0, nitroActive: false, collisionCooldown: 0,
        shield: 0, magnet: 0, rocket: 0, inventory: null, itemSlow: 0, itemProtection: 0,
        itemUseHeld: false, lastItemUseSeq: 0, itemAiDelay: 0, itemHeldTime: 0, lapTimes: [], lastLapStartedAt: 0,
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
    const style = r.personality || 'steady';
    let lane = Math.sin(r.distance * 0.003 + index * 2) * (style === 'steady' ? 1.35 : 2.25);
    const near = this.racers.filter(other => other !== r && !other.finished)
      .map(other => ({ other, delta: this.itemDelta(r, other) }));
    const follower = near.filter(({ delta }) => delta < -4 && delta > -18).sort((a, b) => b.delta - a.delta)[0]?.other;
    // Predictable single defensive line, with enough clearance to avoid
    // weaving into a car already alongside. No position-based speed bonus.
    if (style === 'defensive' && follower) lane = clamp(follower.offset, -3.2, 3.2);
    const localDistance = wrap(r.distance, this.track.length);
    const inStrategyWindow = zone => {
      const ahead = wrap(zone.start - localDistance, this.track.length);
      const inside = localDistance >= zone.start && localDistance <= zone.end;
      return ahead < 45 || inside;
    };
    const section = (this.track.strategySections || []).find(inStrategyWindow);
    if (!section) { r.aiStrategySectionId = null; r.aiStrategyZoneId = null; }
    else {
      // Decide before entry and keep the choice through the section, rather
      // than swerving between replenishing and spending as nitrogen changes.
      let route = section.choices.find(zone => zone.id === r.aiStrategyZoneId);
      if (r.aiStrategySectionId !== section.id || !route) {
        const energy = section.choices.find(zone => zone.nitroRate > 0);
        const sprint = section.choices.find(zone => zone.nitroRate < 0);
        const sprintCost = sprint ? -sprint.nitroRate * (sprint.end - sprint.start) / Math.max(18, r.speed) : Infinity;
        const reserve = style === 'steady' ? 30 : style === 'defensive' ? 18 : 8;
        route = r.nitro > sprintCost + reserve ? sprint : energy;
        route ||= section.choices[0];
        r.aiStrategySectionId = section.id; r.aiStrategyZoneId = route?.id || null;
      }
      if (route) lane = route.lane;
    }
    // Commit to a clear passing lane until the slow car is behind. Recomputing
    // a side every frame makes a driver weave back into the same obstruction.
    let passTarget = near.find(({ other, delta }) => other.id === r.aiPassTargetId && delta > -5 && delta < 38)?.other;
    if (!passTarget) {
      r.aiPassTargetId = null;
      passTarget = near.filter(({ other, delta }) => delta > 0 && delta < Math.max(14, r.speed * .8) &&
        Math.abs(other.offset - r.offset) < 2.6 && (other.speed < 8 || r.speed - other.speed > 2))
        .sort((a, b) => a.delta - b.delta)[0]?.other;
      if (passTarget) {
        const limit = Math.max(2, this.track.width * .5 - 2);
        const candidates = [-1, 1].map(side => clamp(passTarget.offset + side * 3.5, -limit, limit))
          .filter(candidate => Math.abs(candidate - passTarget.offset) >= 2.8 && !near.some(({ other, delta }) =>
            other !== passTarget && Math.abs(delta) < 8 && Math.abs(other.offset - candidate) < 2.6))
          .sort((a, b) => Math.abs(a - r.offset) - Math.abs(b - r.offset));
        if (candidates.length) { r.aiPassTargetId = passTarget.id; r.aiPassLane = candidates[0]; }
      }
    }
    if (r.aiPassTargetId) lane = r.aiPassLane;
    const curvature = curvatureAt(this.track, r.distance + Math.max(3, r.speed * 0.22));
    const previewCurve = Math.max(...[0, 14, 28, 45].map(ahead => Math.abs(curvatureAt(this.track, r.distance + ahead))));
    const desiredYaw = clamp((lane - r.offset) * 0.065 - (r.lateralVelocity || 0) * 0.035, -0.28, 0.28);
    const desiredRate = curvature * r.speed / clamp(1 - curvature * r.offset, 0.6, 1.4) + (desiredYaw - r.yaw) * 2.8;
    const rateLimit = steeringRate(Math.max(4, r.speed), char.handling, r.isDrifting);
    const steer = clamp(desiredRate / Math.max(0.01, rateLimit), -1, 1);
    const cornerSpeed = Math.min(style === 'steady' ? 46 : 50, Math.sqrt((style === 'steady' ? 17 : 19) / Math.max(0.001, previewCurve)), 1.25 / Math.max(0.001, previewCurve));
    const brake = clamp((r.speed - cornerSpeed - 0.5) * 0.09, 0, 0.8);
    const nitro = previewCurve < 0.018 && Math.abs(r.offset) < 5 && r.nitro > 20 && (Math.sin(r.distance * 0.017 + index) > 0.7 || (r.position > 4 && r.nitro > 75));
    const threat = this.mode === 'items' ? itemThreatFor(this, r) : null;
    const useItem = this.mode === 'items' && !r.finished && r.inventory && !(r.itemAiDelay > 0) && (
      (r.inventory === 'magnet' && (r.itemHeldTime > 2 || (this.track.coins || []).some(c => wrap(c.distance - localDistance, this.track.length) < 100))) ||
      (r.inventory === 'shield' && !r.shield && (threat || r.speed < 12 || near.some(({ delta }) => Math.abs(delta) < 12) || r.itemHeldTime > 4)) ||
      (r.inventory === 'rocket' && r.speed > 6 && previewCurve < .035) ||
      (r.inventory === 'bubble' && this.racers.some(other => other !== r && !other.finished && this.itemDelta(r, other) > 3 && this.itemDelta(r, other) < 35 && Math.abs(other.offset - r.offset) < 3)) ||
      (r.inventory === 'jelly' && this.racers.some(other => other !== r && !other.finished && this.itemDelta(r, other) < -3 && this.itemDelta(r, other) > -24 && Math.abs(other.offset - r.offset) < 4))
    );
    const canDrift = style !== 'steady' && !r.aiPassTargetId && !(r.aiDriftCooldown > 0) && r.speed > 18 && brake < .1 &&
      Math.abs(lane - r.offset) < 2 && Math.abs(r.yaw) < .23 && previewCurve > .006 && previewCurve < .026 && Math.abs(steer) > .17 && Math.abs(steer) < .7;
    const drift = r.isDrifting ? r.driftCharge < (style === 'drifter' ? .56 : .25) && Math.abs(r.yaw) < .32 && Math.abs(lane - r.offset) < 3 : canDrift;
    return { throttle: 1, brake, steer, drift, nitro, useItem: Boolean(useItem), speedLimit: cornerSpeed };
  }

  stepDraft(r, input, dt, prediction) {
    if (this.mode === 'time-trial' || r.finished) {
      r.draftBoost = 0; r.draftCooldown = 0; r.draftCharge = 0;
      r.drafting = false; r.draftTargetId = null;
      return;
    }
    r.draftBoost = Math.max(0, (r.draftBoost || 0) - dt);
    r.draftCooldown = Math.max(0, (r.draftCooldown || 0) - dt);
    let target;
    if (this.mode !== 'time-trial' && !r.finished && !r.offroad && r.speed >= 12 && input.throttle > 0 && !input.brake) {
      const pose = this.itemPose(r);
      target = this.racers.filter(other => {
        const ahead = this.itemDelta(r, other);
        if (other === r || other.finished || other.speed < 10 || ahead < 5 || ahead > 26 || Math.abs(other.offset - r.offset) > 1.65) return false;
        const aheadPose = this.itemPose(other);
        return Math.abs(pose.y - aheadPose.y) < 2.5 && Math.hypot(pose.x - aheadPose.x, pose.z - aheadPose.z) < 29;
      }).sort((a, b) => this.itemDelta(r, a) - this.itemDelta(r, b))[0];
    }
    r.drafting = Boolean(target);
    if (target && !r.draftCooldown) {
      if (r.draftTargetId && r.draftTargetId !== target.id) r.draftCharge = 0;
      r.draftTargetId = target.id;
      r.draftCharge = Math.min(1, (r.draftCharge || 0) + dt / 1.05);
      // Prediction may show a charged wake, but only authority can award a
      // breakthrough. A replay never manufactures rewards or statistics.
      if (r.draftCharge >= 1 - 1e-9 && !prediction) {
        r.draftCharge = 0; r.draftBoost = 1.35; r.draftCooldown = 3.2;
        r.stats.draftBoosts++;
        if (this.humanIds.has(r.id)) this.emit('draftBoost', '尾流突破！', { racerId: r.id, duration: 1.35 });
      }
    } else {
      r.draftCharge = Math.max(0, (r.draftCharge || 0) - dt * 1.25);
      if (!r.draftCharge) r.draftTargetId = null;
    }
  }

  stepRacer(r, input, dt, { prediction = false } = {}) {
    const char = characterFor(r.character), human = this.humanIds.has(r.id);
    const before = r.distance, wasDrifting = r.isDrifting;
    r.stats ||= newStats(); r.strategyRewards ||= {};
    r.boost = Math.max(0, r.boost - dt); r.driftBoost = Math.max(0, r.driftBoost - dt);
    r.spin = Math.max(0, r.spin - dt); r.collisionCooldown = Math.max(0, r.collisionCooldown - dt);
    r.recovery = Math.max(0, r.recovery - dt);
    r.shield = Math.max(0, (r.shield || 0) - dt);
    r.magnet = Math.max(0, (r.magnet || 0) - dt);
    r.rocket = Math.max(0, (r.rocket || 0) - dt);
    r.itemSlow = Math.max(0, (r.itemSlow || 0) - dt);
    r.itemProtection = Math.max(0, (r.itemProtection || 0) - dt);
    if (!prediction) {
      r.aiDriftCooldown = Math.max(0, (r.aiDriftCooldown || 0) - dt);
      r.itemHeldTime = r.inventory ? (r.itemHeldTime || 0) + dt : 0;
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
    const strategy = !r.finished ? this.track.strategyAt?.(r.distance, r.offset) : null;
    const strategyRate = clamp(finite(strategy?.nitroRate), -20, 12);
    const affordable = strategyRate >= 0 || r.nitro >= -strategyRate * dt;
    const strategySpeed = affordable ? clamp(finite(strategy?.speedFactor, 1), .8, 1.12) : 1;
    r.strategyId = strategy?.id || null; r.strategyLabel = strategy?.label || '';
    // Keep the HUD aligned with this actual physics step. A nonzero remainder
    // can still be too small to fund the line's next acceleration step.
    r.strategyActive = Boolean(strategy && affordable);
    r.strategySpeedFactor = strategySpeed;
    if (strategy && affordable) {
      r.nitro = clamp(r.nitro + strategyRate * dt, 0, 100);
      const lap = Math.floor(Math.max(0, r.distance) / this.track.length);
      if (strategy.boost > 0 && r.strategyRewards[strategy.id] !== lap) {
        r.strategyRewards[strategy.id] = lap;
        r.boost = Math.max(r.boost, Math.min(.6, strategy.boost));
        if (!prediction && human) this.emit('route', strategy.label, { racerId: r.id, strategyId: strategy.id });
      }
    }
    r.isDrifting = input.drift && Math.abs(input.steer) > 0.15 && r.speed > 11 && !offroad && !r.finished;
    if (r.isDrifting) {
      const priorStage = driftStageFor(r.driftCharge);
      r.driftCharge = Math.min(1, r.driftCharge + dt * (0.47 + Math.abs(input.steer) * 0.2) * clamp(finite(strategy?.driftChargeFactor, 1), 1, 1.16));
      const stage = driftStageFor(r.driftCharge);
      if (!prediction) {
        r.stats.bestDrift = Math.max(r.stats.bestDrift, r.driftCharge);
        if (!wasDrifting && human) this.emit('drift', '漂移蓄力', { racerId: r.id });
        if (stage > priorStage && human) this.emit('driftStage', `${DRIFT_STAGES[stage - 1].label}就绪`, { racerId: r.id, stage });
      }
    } else if (wasDrifting) {
      const stage = driftStageFor(r.driftCharge), reward = DRIFT_STAGES[stage - 1];
      if (reward && !offroad && !r.finished) {
        const charge = r.driftCharge;
        r.boost = Math.max(r.boost, reward.duration);
        r.driftBoost = r.boost;
        r.nitro = Math.min(100, r.nitro + reward.nitro);
        if (!prediction) {
          r.stats.bestDrift = Math.max(r.stats.bestDrift, charge); r.stats.driftBoosts++;
          if (human) this.emit('driftBoost', `${reward.label}加速！氮气 +${reward.nitro}`, { racerId: r.id, charge, stage, duration: reward.duration });
        }
      }
      r.aiDriftCooldown = 2.8;
      r.driftCharge = 0;
    } else r.driftCharge = Math.max(0, r.driftCharge - dt * 0.5);
    r.driftStage = driftStageFor(r.driftCharge);
    this.stepDraft(r, input, dt, prediction);

    r.nitroActive = input.nitro && r.nitro > 0 && r.speed > 5 && !offroad && !r.finished;
    if (r.nitroActive) r.nitro = Math.max(0, r.nitro - dt * 24 / char.nitro);
    const boosted = r.nitroActive || r.boost > 0 || r.rocket > 0 || r.draftBoost > 0;
    const aiFactor = human ? 1 : (DIFFICULTIES[this.options.difficulty] || DIFFICULTIES.normal) * r.aiSkill;
    let maxSpeed = 34 * char.speed * aiFactor;
    if (boosted) maxSpeed += r.rocket > 0 ? 16 : r.nitroActive || r.boost > 0 ? 12 : 7;
    maxSpeed *= strategySpeed;
    maxSpeed *= 1 - grass * 0.45;
    if (r.spin) maxSpeed *= 0.55;
    if (r.itemSlow > 0) maxSpeed *= ITEM_RULES.speedFactor;
    if (Number.isFinite(input.speedLimit)) maxSpeed = Math.min(maxSpeed, input.speedLimit);
    const motion = stepKartPhysics(r, input, this.track, dt, { maxSpeed, acceleration: r.rocket > 0 ? 30 : boosted ? 18 : 12.5, handling: char.handling });
    if (motion.railImpact > 0 && !prediction && !r.finished) {
      r.stats.clean = false;
      if (!r.recovery) {
        r.stats.wallHits++; r.recovery = 1.2;
        if (human && motion.railImpact > 1) this.emit(r.shield > 0 ? 'shieldBlock' : 'bump', r.shield > 0 ? '泡泡护盾挡住擦碰！' : '擦碰护栏，松开转向驶回赛道', { racerId: r.id, impact: motion.railImpact, surface: 'rail' });
      }
    }
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
      const gapToLeader = Math.max(0, ...this.racers.map(other => other.distance - r.distance));
      const type = ITEMS[box.type] ? box.type : chooseItem(r.position, this.racers.length, () => this.itemRandom(), gapToLeader);
      r.itemCollected[box.id] = lap; r.inventory = type; r.itemAiDelay = .55; r.itemHeldTime = 0;
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
    for (const key of ['shield', 'magnet', 'rocket', 'itemSlow', 'itemProtection', 'boost', 'driftBoost', 'draftCharge', 'draftBoost', 'draftCooldown', 'driftCharge', 'driftStage']) r[key] = 0;
    r.nitroActive = false; r.drafting = false; r.isDrifting = false; r.draftTargetId = null;
    r.strategyId = null; r.strategyLabel = ''; r.strategyActive = false; r.strategySpeedFactor = 1;
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
    const source = this.racers.find(other => other.id === object.ownerId);
    r.stats ||= newStats();
    if (r.shield > 0) {
      r.shield = 0;
      r.stats.blocks++;
      this.emit('shieldBlock', '泡泡护盾挡住了道具！', { racerId: r.id, sourceId: object.ownerId, targetId: r.id, itemType: object.type, objectId: object.id });
      if (source) this.emit('itemConfirm', `${r.name}用护盾挡住了攻击`, { racerId: source.id, sourceId: source.id, targetId: r.id, outcome: 'blocked', itemType: object.type, objectId: object.id });
      return true;
    }
    // One bounded speed reduction. Steering, drift and orientation remain in
    // the driver's control; subsequent protected hits do not compound it.
    r.speed = Math.max(0, r.speed * ITEM_RULES.speedFactor);
    r.itemSlow = ITEM_RULES.slowDuration;
    if (source) { source.stats ||= newStats(); source.stats.itemHits++; }
    this.emit('itemHit', '被道具击中，短暂减速', { racerId: r.id, sourceId: object.ownerId, targetId: r.id, itemType: object.type, objectId: object.id, duration: ITEM_RULES.slowDuration });
    if (source) this.emit('itemConfirm', `命中${r.name}！`, { racerId: source.id, sourceId: source.id, targetId: r.id, outcome: 'hit', itemType: object.type, objectId: object.id });
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
      for (const r of [a, b]) {
        r.stats ||= newStats();
        if (!r.collisionCooldown) r.stats.collisions++;
        r.stats.clean = false;
      }
      const audible = impact >= .6 && !(a.collisionCooldown && b.collisionCooldown);
      a.collisionCooldown = 0.55; b.collisionCooldown = 0.55;
      for (const r of [a, b]) if (audible && this.humanIds.has(r.id)) this.emit(r.shield > 0 ? 'shieldBlock' : 'bump', r.shield > 0 ? '泡泡护盾挡住碰撞！' : '轻微碰撞', { racerId: r.id, impact });
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
    // Hysteresis counts an actual pass from two metres behind to two metres
    // ahead, rather than awarding a new overtake every time cars touch noses.
    // Authority only calls rank; input prediction never increments statistics.
    if (this.phase === 'racing' && this.elapsed > 4 && this.mode !== 'time-trial') {
      for (let i = 0; i < this.racers.length; i++) for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i], b = this.racers[j];
        if (a.finished || b.finished) continue;
        const gap = a.distance - b.distance;
        if (Math.abs(gap) <= 2) continue;
        const key = `${a.id}:${b.id}`, sign = Math.sign(gap), previous = this.passStates[key];
        if (previous !== undefined && previous !== sign) {
          const passing = sign > 0 ? a : b;
          passing.stats ||= newStats(); passing.stats.overtakes++;
        }
        this.passStates[key] = sign;
      }
    }
    sorted.forEach((r, i) => { r.position = i + 1; });
    return sorted;
  }
  finish() {
    this.phase = 'finished';
    for (const racer of this.racers) this.clearRacerItems(racer);
    this.itemObjects = [];
    this.results = this.rank().map(r => ({ id: r.id, name: r.name, character: r.character, color: r.color, position: r.position, finishTime: r.finishTime, finished: r.finished, distance: r.distance, coins: r.coins, personality: r.personality, stats: { ...r.stats } }));
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
      humanIds: [...this.humanIds], racers: this.racers.map(r => ({ ...r, nextPad: undefined, stats: { ...r.stats }, strategyRewards: { ...r.strategyRewards }, collected: { ...r.collected }, collectedLaps: { ...r.collectedLaps }, itemCollected: { ...r.itemCollected }, lapTimes: [...r.lapTimes] })),
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
      stats: { ...newStats(), ...r.stats }, strategyRewards: { ...r.strategyRewards },
      strategyActive: Boolean(r.strategyActive), strategySpeedFactor: clamp(finite(r.strategySpeedFactor, 1), .8, 1.12),
      driftStage: driftStageFor(r.driftCharge || 0), draftCharge: r.draftCharge || 0, draftBoost: r.draftBoost || 0, draftCooldown: r.draftCooldown || 0,
      itemSlow: r.itemSlow || 0, itemProtection: r.itemProtection || 0, lastItemUseSeq: r.lastItemUseSeq || 0, itemUseHeld: Boolean(r.itemUseHeld),
      collected: { ...r.collected }, collectedLaps: { ...r.collectedLaps }, itemCollected: { ...r.itemCollected }, lapTimes: [...(r.lapTimes || [])] }));
    for (const racer of this.racers) if (racer.finished || this.phase === 'finished') this.clearRacerItems(racer);
    if (this.phase === 'finished') this.itemObjects = [];
    this.player = this.racers.find(r => r.id === localPlayerId) || this.racers[0];
    if (this.player?.finished) this.finishTime = this.player.finishTime;
    this.events.push(...(state.events || []).filter(e => !e.racerId || e.racerId === this.player.id));
  }
}
