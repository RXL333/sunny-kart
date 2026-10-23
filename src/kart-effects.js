import { DRIFT_STAGES, driftStageFor } from './game/race.js';

// Use the same stages as the simulation: a spark must never announce a reward
// that the player has not actually earned yet.
export const DRIFT_STAGE_COLORS = Object.freeze([0x9de8f4, ...DRIFT_STAGES.map(stage => parseInt(stage.color.slice(1), 16))]);
const validHex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export function normalizeCosmetics(value = {}) {
  return { paint: validHex(value?.paint) ? value.paint.toLowerCase() : null, trail: validHex(value?.trail) ? value.trail.toLowerCase() : null, ...(value?.title==='晴空杯车手'?{title:value.title}:{}) };
}

export function driftStageColor(racer) {
  const stage = Number.isInteger(racer.driftStage) ? Math.max(0, Math.min(3, racer.driftStage))
    : driftStageFor(racer.driftCharge ?? 0);
  return DRIFT_STAGE_COLORS[stage];
}

export function kartSparkColor(racer, cosmetics = {}) {
  if (racer.isDrifting) return driftStageColor(racer);
  if (racer.rocket > 0) return 0xff995f;
  if (racer.nitroActive || racer.draftBoost > 0 || racer.boost > 0) {
    if (validHex(cosmetics.trail)) return parseInt(cosmetics.trail.slice(1), 16);
    return racer.nitroActive || racer.draftBoost > 0 ? 0x6eeaff : 0xffdd62;
  }
  return 0x64d8ff;
}
