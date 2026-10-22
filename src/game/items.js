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
export function chooseItem(position = 1, racerCount = 8, random = Math.random) {
  const trailing = Math.max(0, Math.min(1, (position - 1) / Math.max(1, racerCount - 1)));
  const weights = [
    ['rocket', 15 + trailing * 20], ['shield', 25 - trailing * 10],
    ['magnet', 20 + trailing * 5], ['bubble', 20], ['jelly', 20 - trailing * 15],
  ];
  let roll = Math.max(0, Math.min(.999999999, random())) * weights.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [type, weight] of weights) { roll -= weight; if (roll < 0) return type; }
  return 'jelly';
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
