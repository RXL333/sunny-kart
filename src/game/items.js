// Pickup locations are deterministic; only authority chooses a box's reward.
// Every driver gets one use of each box/crystal per lap.
export const ITEMS = Object.freeze({
  shield: Object.freeze({ name: '泡泡护盾', duration: 7, color: 0x8ee9ff, icon: '◉' }),
  magnet: Object.freeze({ name: '能量磁铁', duration: 8, color: 0xec9aff, icon: '✦' }),
  rocket: Object.freeze({ name: '火箭冲刺', duration: 2.8, color: 0xffb65c, icon: '➤' }),
  bubble: Object.freeze({ name: '泡泡弹', duration: 3, color: 0x84dfff, icon: '●' }),
  jelly: Object.freeze({ name: '果冻陷阱', duration: 9, color: 0xd99aff, icon: '◆' }),
});

export const ITEM_RULES = Object.freeze({ slowDuration: 1, protectionDuration: 2, speedFactor: .75, maxObjects: 24, bubbleSpeed: 52, hitRadius: 2 });

// Rank shifts useful rewards modestly, without exclusive items or advantages
// for AI. Call this once on pickup, never during client prediction/replay.
export function itemWeights(position = 1, racerCount = 8, gapToLeader) {
  const rank = Math.max(0, Math.min(1, (position - 1) / Math.max(1, racerCount - 1)));
  // A tightly packed eighth place needs less help than a driver a straight
  // behind. This changes the reward only, never a driver's engine or steering.
  const gap = Number.isFinite(gapToLeader) ? Math.max(0, Math.min(1, gapToLeader / 120)) : rank;
  const trailing = rank * .45 + gap * .55;
  return [
    ['rocket', 15 + trailing * 20], ['shield', 25 - trailing * 10],
    ['magnet', 20 + trailing * 5], ['bubble', 20], ['jelly', 20 - trailing * 15],
  ];
}

export function chooseItem(position = 1, racerCount = 8, random = Math.random, gapToLeader) {
  const weights = itemWeights(position, racerCount, gapToLeader);
  let roll = Math.max(0, Math.min(.999999999, random())) * weights.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [type, weight] of weights) { roll -= weight; if (roll < 0) return type; }
  return 'jelly';
}

// Pure, local presentation hint. It never steers an attack or exposes a trap
// through a bridge: only objects on this stretch of road can warn the driver.
export function itemThreatFor(race, racer = race?.player) {
  if (!racer || racer.finished || race.mode !== 'items') return null;
  const length = race.track.length;
  const origin = race.itemPose(racer);
  let nearest = null;
  for (const object of race.itemObjects || []) {
    if (object.ownerId === racer.id || object.life <= 0) continue;
    const raw = object.distance - racer.distance;
    const delta = raw - Math.round(raw / length) * length;
    const lateral = object.offset - racer.offset;
    if (Math.abs(lateral) > 4) continue;
    // A forward bubble behind the car is incoming; a passed trap is harmless.
    if (object.type === 'bubble' && (delta > 3 || delta < -32 || (object.speed || 0) <= racer.speed)) continue;
    if (object.type === 'jelly' && (delta < 0 || delta > 24)) continue;
    if (object.type !== 'bubble' && object.type !== 'jelly') continue;
    const pose = race.itemPose(object);
    const distance = Math.hypot(pose.x - origin.x, pose.y - origin.y, pose.z - origin.z);
    if (Math.abs(pose.y - origin.y) > 2.5 || distance > 35) continue;
    const closing = object.type === 'bubble' ? object.speed - racer.speed : Math.max(1, racer.speed);
    const timeToImpact = Math.abs(delta) / closing;
    const threat = { type: object.type, objectId: object.id, sourceId: object.ownerId,
      direction: delta < 0 ? 'rear' : 'front', side: Math.abs(lateral) < 1 ? 'center' : lateral > 0 ? 'right' : 'left',
      distance, timeToImpact };
    if (!nearest || timeToImpact < nearest.timeToImpact) nearest = threat;
  }
  return nearest;
}

export function createItemBoxes(track) {
  if (track.itemBoxes?.length) return track.itemBoxes.map(box => ({ ...box }));
  if (!track.id || !Number.isFinite(track.length) || track.length <= 0) return [];
  return Array.from({ length: 6 }, (_, index) => ({
    id: `item-${index}`, distance: track.length * (.08 + index * .15),
    lane: [-2.5, 0, 2.5][index % 3], type: 'random',
  }));
}

export function pickupLap(racer, track) {
  // bestDistance advances only on authority, so a predicted crossing cannot
  // prematurely respawn the next lap's pickups and flash after reconciliation.
  const distance = racer.bestDistance ?? racer.distance ?? 0;
  // Finishing must not briefly respawn a fourth set of rewards beneath the
  // results screen. The race's clamped lap is the final completed lap then.
  return racer.finished && Number.isInteger(racer.lap)
    ? Math.max(0, racer.lap - 1)
    : Math.max(0, Math.floor(distance / track.length));
}

export function isPickupCollected(racer, id, track, items = false) {
  const laps = items ? racer.itemCollected : racer.collectedLaps;
  return Number.isInteger(laps?.[id]) && laps[id] >= pickupLap(racer, track);
}
