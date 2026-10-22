// Local time-trial recordings. Versioning prevents comparing incompatible physics.
export const GHOST_PHYSICS_VERSION = 'sunny-physics-4';
export const GHOST_SAMPLE_INTERVAL = 0.1;
export const MAX_GHOST_SECONDS = 1800;
const MAX_SAMPLES = Math.ceil(MAX_GHOST_SECONDS / GHOST_SAMPLE_INTERVAL) + 2;
const MAX_STORAGE_BYTES = 2_000_000;
const distanceIndexes = new WeakMap();
const round = (n, places = 3) => Number(n.toFixed(places));
const angle = n => Math.atan2(Math.sin(n), Math.cos(n));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function metadata(value) {
  if (!value || typeof value.trackId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.trackId)) return null;
  if (!['fox', 'rabbit', 'panda'].includes(value.character)) return null;
  const laps = value.laps ?? 3, physicsVersion = value.physicsVersion ?? GHOST_PHYSICS_VERSION;
  if (!Number.isInteger(laps) || laps < 1 || laps > 9 || typeof physicsVersion !== 'string' || !/^[a-z0-9-]{1,64}$/.test(physicsVersion)) return null;
  if (!Number.isFinite(value.trackLength) || value.trackLength < 10 || value.trackLength > 50_000) return null;
  return { trackId: value.trackId, character: value.character, laps, trackLength: value.trackLength, physicsVersion };
}

export function ghostKey(value) {
  const meta = metadata(value);
  if (!meta) throw new TypeError('Invalid time-trial configuration');
  return `sunny-ghost-v1-${meta.physicsVersion}-${meta.trackId}-${round(meta.trackLength)}-${meta.character}-${meta.laps}`;
}

function sameMetadata(a, b) {
  return ['trackId', 'character', 'laps', 'physicsVersion'].every(key => a[key] === b[key]) && Math.abs(a.trackLength - b.trackLength) < 0.001;
}

// Compact samples are [elapsed, distance, offset, yaw, speed].
export function validateGhost(recording, expected) {
  const meta = metadata(recording);
  if (!meta || recording.schema !== 1 || recording.mode !== 'time-trial') return false;
  if (expected) { const other = metadata(expected); if (!other || !sameMetadata(meta, other)) return false; }
  if (!Number.isFinite(recording.time) || recording.time <= 0 || recording.time > MAX_GHOST_SECONDS) return false;
  if (!Array.isArray(recording.samples) || recording.samples.length < 2 || recording.samples.length > MAX_SAMPLES) return false;
  const first = recording.samples[0], last = recording.samples.at(-1), total = meta.trackLength * meta.laps;
  if (!Array.isArray(first) || first[0] !== 0 || Math.abs(first[1]) > 0.1 || !Array.isArray(last)) return false;
  if (Math.abs(last[0] - recording.time) > 0.002 || Math.abs(last[1] - total) > 0.03) return false;
  let previous = null;
  for (const sample of recording.samples) {
    if (!Array.isArray(sample) || sample.length !== 5 || sample.some(n => !Number.isFinite(n))) return false;
    const [time, distance, offset, yaw, speed] = sample;
    if (time < 0 || time > recording.time + 0.002 || distance < -2 || distance > total + 0.03 || Math.abs(offset) > 30 || Math.abs(yaw) > Math.PI + 0.001 || speed < 0 || speed > 100) return false;
    if (previous) {
      const dt = time - previous[0];
      if (dt <= 0 || dt > GHOST_SAMPLE_INTERVAL + 0.002 || Math.abs(distance - previous[1]) > 100 * dt + 0.1) return false;
    }
    previous = sample;
  }
  return true;
}

function readPose(elapsed, player) {
  const sample = [elapsed, player?.distance, player?.offset ?? 0, angle(player?.yaw ?? 0), player?.speed ?? 0];
  return sample.every(Number.isFinite) && elapsed >= 0 && Math.abs(sample[2]) <= 30 && sample[4] >= 0 && sample[4] <= 100 ? sample : null;
}

function between(a, b, t) {
  const weight = clamp((t - a[0]) / Math.max(0.000001, b[0] - a[0]), 0, 1);
  return [t, a[1] + (b[1] - a[1]) * weight, a[2] + (b[2] - a[2]) * weight, angle(a[3] + angle(b[3] - a[3]) * weight), a[4] + (b[4] - a[4]) * weight];
}

export class GhostRecorder {
  constructor(options) {
    this.meta = metadata(options);
    if (!this.meta) throw new TypeError('Invalid time-trial configuration');
    this.samples = []; this.previous = null; this.nextSample = 0; this.invalid = false; this.completed = false;
  }
  record(elapsed, player) {
    if (this.invalid || this.completed) return false;
    const pose = readPose(elapsed, player);
    if (!pose || elapsed > MAX_GHOST_SECONDS || this.samples.length >= MAX_SAMPLES) { this.invalid = true; return false; }
    if (!this.previous) {
      // Never invent a start for a recording begun partway through a race.
      if (elapsed > 0.25 || Math.abs(pose[1]) > 1) { this.invalid = true; return false; }
      this.previous = [0, 0, pose[2], pose[3], 0];
      this.samples.push(this.previous); this.nextSample = GHOST_SAMPLE_INTERVAL;
    }
    const dt = elapsed - this.previous[0];
    if (dt < 0 || dt > 1 || Math.abs(pose[1] - this.previous[1]) > Math.max(0.1, 100 * dt + 0.1)) { this.invalid = true; return false; }
    if (dt === 0) return true;
    while (this.nextSample <= elapsed + 1e-8) {
      this.samples.push(between(this.previous, pose, this.nextSample));
      this.nextSample = round(this.nextSample + GHOST_SAMPLE_INTERVAL, 6);
    }
    this.previous = pose;
    return true;
  }
  finish(race) {
    if (this.invalid || this.completed || race.mode !== 'time-trial' || race.multiplayer || race.phase !== 'finished' || !race.player?.finished) return null;
    const time = race.player.finishTime, total = this.meta.trackLength * this.meta.laps;
    if (!Number.isFinite(time) || time <= 0 || time > MAX_GHOST_SECONDS || race.player.distance < total - 0.03 || !this.previous) return null;
    if ((race.track?.id && race.track.id !== this.meta.trackId) || (race.player.character && race.player.character !== this.meta.character) || (race.laps && race.laps !== this.meta.laps)) return null;
    // A render frame can jump directly from racing to finished. Include that
    // final short simulation segment even if the caller recorded only racing.
    if (time > this.previous[0] && !this.record(time, { ...race.player, distance: total })) return null;
    // The simulation supplies the interpolated finish time. Trim any frame
    // overshoot, then interpolate the final pose to the actual finish line.
    const finalPose = readPose(time, { ...race.player, distance: total });
    const lastBefore = [...this.samples].reverse().find(sample => round(sample[0]) < round(time));
    if (!lastBefore || !finalPose || time - lastBefore[0] > GHOST_SAMPLE_INTERVAL + 0.002) return null;
    const samples = this.samples.filter(sample => round(sample[0]) < round(time));
    samples.push(finalPose);
    const recording = { schema: 1, mode: 'time-trial', ...this.meta, time: round(time), samples: samples.map(sample => sample.map((n, i) => round(n, i === 3 ? 4 : 3))) };
    if (!validateGhost(recording, this.meta)) return null;
    this.completed = true;
    return recording;
  }
}

export function ghostPoseAt(recording, elapsed) {
  if (!recording?.samples?.length || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > recording.time) return null;
  const samples = recording.samples;
  let lo = 0, hi = samples.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (samples[mid][0] <= elapsed) lo = mid; else hi = mid; }
  const pose = between(samples[lo], samples[hi], elapsed);
  return { elapsed, distance: pose[1], offset: pose[2], yaw: pose[3], speed: pose[4] };
}

export function ghostDeltaAt(recording, distance, elapsed) {
  if (!recording?.samples?.length || !Number.isFinite(distance) || !Number.isFinite(elapsed) || distance < 0 || distance > recording.trackLength * recording.laps || elapsed < 0) return null;
  const samples = recording.samples;
  if (distance === 0 && samples[0][1] === 0) return elapsed - samples[0][0];
  // Index only new forward progress. A barrier can briefly move a car back;
  // retaining the original segment keeps the first crossing at each distance.
  // Samples belong to a completed immutable recording. Weak caching avoids
  // rescanning up to 18,000 samples on every HUD update or retaining old races.
  let index = distanceIndexes.get(recording);
  if (!index || index.source !== samples || index.count !== samples.length) {
    const segments = []; let furthest = samples[0][1];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (b[1] <= furthest || b[1] <= a[1]) continue;
      const start = Math.max(furthest, a[1]);
      const startTime = a[0] + (b[0] - a[0]) * (start - a[1]) / (b[1] - a[1]);
      segments.push([start, b[1], startTime, b[0]]); furthest = b[1];
    }
    index = { source: samples, count: samples.length, segments };
    distanceIndexes.set(recording, index);
  }
  const segments = index.segments;
  let lo = 0, hi = segments.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (segments[mid][1] < distance) lo = mid + 1; else hi = mid; }
  const segment = segments[lo];
  if (!segment || distance < segment[0]) return null;
  const reference = segment[2] + (segment[3] - segment[2]) * (distance - segment[0]) / (segment[1] - segment[0]);
  return elapsed - reference; // Negative = ahead, positive = behind.
}

export class GhostStore {
  constructor({ storage, onError = () => {} } = {}) {
    this.onError = onError; this.session = new Map();
    try { this.storage = storage === undefined ? globalThis.localStorage : storage; }
    catch { this.storage = null; }
  }
  load(options) {
    const key = ghostKey(options);
    if (this.session.has(key)) return this.session.get(key);
    if (!this.storage) return null;
    try {
      const serialized = this.storage.getItem(key);
      if (!serialized || serialized.length > MAX_STORAGE_BYTES) return null;
      const recording = JSON.parse(serialized);
      if (!validateGhost(recording, options)) return null;
      this.session.set(key, recording);
      return recording;
    } catch { return null; }
  }
  save(recording) {
    if (!validateGhost(recording)) return { saved: false, reason: 'invalid' };
    const previous = this.load(recording);
    if (previous && previous.time <= recording.time) return { saved: false, reason: 'slower', best: previous };
    this.session.set(ghostKey(recording), recording);
    if (!this.storage) { this.onError('浏览器未允许保存，幽灵仅在本次游玩可用'); return { saved: false, reason: 'storage', best: recording }; }
    try {
      const serialized = JSON.stringify(recording);
      if (serialized.length > MAX_STORAGE_BYTES) return { saved: false, reason: 'too-large' };
      this.storage.setItem(ghostKey(recording), serialized);
      return { saved: true, reason: 'best', best: recording };
    } catch {
      this.onError('成绩已完成，但浏览器存储空间不足或禁止保存');
      return { saved: false, reason: 'storage', best: recording };
    }
  }
}
