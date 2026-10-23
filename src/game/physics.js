// Gentle, planar arcade physics shared by the browser and authoritative server.
// Coordinates are road-tangent distance / right-normal offset; yaw is relative
// to the road, so a car with centered steering keeps its world heading in bends.
export const PHYSICS = Object.freeze({
  fixedStep: 1 / 120,
  bodyRadius: 0.94,
  bodyHalfSpan: 0.76,
  contactSlop: 0.004,
  restitution: 0.08,
  collisionFriction: 0.24,
  solverIterations: 8,
});
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const damp = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);

export function curvatureAt(track, distance) {
  const sample = track.sample(distance);
  if (Number.isFinite(sample.curvature)) return sample.curvature;
  return angle(track.sample(distance + 1.5).heading - track.sample(distance - 1.5).heading) / 3;
}

export function steeringRate(speed, handling = 1, drifting = false) {
  return (2.25 / (1 + Math.abs(speed) / 38)) * handling * (drifting ? 1.22 : 1) * Math.min(1, Math.abs(speed) / 4);
}

export function offroadAmount(track, offset) {
  return smooth((Math.abs(offset) - track.width * 0.5 + 0.25) / 2.1);
}

export function kineticEnergy(racer) {
  return 0.5 * (racer.speed ** 2 + (racer.lateralVelocity || 0) ** 2);
}

export function resolveRailCollision(racer, track, dt = PHYSICS.fixedStep) {
  const wall = track.railOffset ?? track.width * 0.5 + 3;
  const extent = PHYSICS.bodyRadius + Math.abs(Math.sin(racer.yaw || 0)) * PHYSICS.bodyHalfSpan;
  const limit = Math.max(1, wall - extent);
  if (Math.abs(racer.offset) <= limit) return 0;
  const side = Math.sign(racer.offset);
  racer.offset = side * limit;
  const outward = (racer.lateralVelocity || 0) * side;
  if (outward <= 0) return 0;
  racer.lateralVelocity = -side * outward * PHYSICS.restitution;
  // Sliding into a rail dissipates forward momentum without a violent spin.
  racer.speed = Math.max(0, racer.speed - Math.min(racer.speed * 0.22, outward * 0.36) * (racer.shield > 0 ? .15 : 1));
  racer.yaw = damp(racer.yaw || 0, 0, 5, dt);
  racer.yawRate = (racer.yawRate || 0) * 0.65;
  return outward;
}

export function stepKartPhysics(racer, input, track, dt, options = {}) {
  const handling = options.handling || 1;
  const sample = track.sample(racer.distance);
  const curvature = Number.isFinite(sample.curvature) ? sample.curvature : curvatureAt(track, racer.distance);
  const grass = offroadAmount(track, racer.offset);
  const drifting = Boolean(racer.isDrifting);
  racer.lateralVelocity ||= 0; racer.yawRate ||= 0;
  const targetRate = input.steer * steeringRate(racer.speed, handling, drifting);
  racer.yawRate = damp(racer.yawRate, targetRate, drifting ? 5.2 : 8.5, dt);
  racer.yaw = clamp(racer.yaw + racer.yawRate * dt, -1.22, 1.22);

  const sin = Math.sin(racer.yaw), cos = Math.cos(racer.yaw);
  let forward = racer.speed * cos + racer.lateralVelocity * sin;
  let sideways = -racer.speed * sin + racer.lateralVelocity * cos;
  const maxSpeed = options.maxSpeed ?? 34;
  const desired = input.throttle * maxSpeed;
  const acceleration = options.acceleration ?? 12.5;
  // Engine works in the car's facing direction; lifting and braking dissipate
  // energy. The lateral tire force only changes direction / loses energy.
  if (forward < desired) forward = Math.min(desired, forward + acceleration * input.throttle * dt);
  else forward = Math.max(desired, forward - (input.throttle ? 7 : 6.5) * dt);
  forward = Math.max(0, forward - input.brake * 27 * dt);
  forward = Math.max(0, forward - Math.max(0, sample.slope || 0) * 5.4 * dt);
  const grip = (drifting ? 2.3 : 8.8) * (1 - grass * 0.45);
  sideways *= Math.exp(-grip * dt);
  forward *= Math.exp(-grass * (0.25 + Math.abs(forward) * 0.012) * dt);
  racer.speed = Math.max(0, forward * cos - sideways * sin);
  racer.lateralVelocity = forward * sin + sideways * cos;
  const metric = clamp(1 - curvature * racer.offset, 0.55, 1.5);
  const distanceStep = racer.speed * dt / metric;
  racer.distance += distanceStep;
  racer.offset += racer.lateralVelocity * dt;
  const roadRotation = angle(track.sample(racer.distance).heading - sample.heading);
  racer.yaw = clamp(angle(racer.yaw - roadRotation), -1.22, 1.22);
  // Rotate velocity into the next road frame: this is the outward inertial
  // effect in curves, rather than an artificial automatic path-follow force.
  const c = Math.cos(roadRotation), s = Math.sin(roadRotation), speed = racer.speed;
  racer.speed = Math.max(0, speed * c + racer.lateralVelocity * s);
  racer.lateralVelocity = -speed * s + racer.lateralVelocity * c;
  const impact = resolveRailCollision(racer, track, dt);
  racer.offroadAmount = offroadAmount(track, racer.offset);
  racer.offroad = racer.offroadAmount > 0.2;
  return { railImpact: impact, distanceStep, curvature };
}

function nearestDelta(a, b, length) {
  const d = b.distance - a.distance;
  return d - Math.round(d / length) * length;
}

function pose(racer, track) {
  const p = track.sample(racer.distance), heading = p.heading || 0;
  const tx = p.tx ?? Math.sin(heading), tz = p.tz ?? Math.cos(heading);
  const nx = p.nx ?? tz, nz = p.nz ?? -tx;
  const sin = Math.sin(racer.yaw || 0), cos = Math.cos(racer.yaw || 0);
  return {
    x: (p.x ?? 0) + nx * racer.offset, y: p.y ?? 0, z: (p.z ?? racer.distance) + nz * racer.offset,
    tx, tz, nx, nz, fx: tx * cos + nx * sin, fz: tz * cos + nz * sin,
    metric: clamp(1 - (p.curvature || 0) * racer.offset, 0.3, 1.6),
  };
}

// Deepest contact between the two overlapping circles forming each body.
export function kartContact(a, b, track) {
  const along = nearestDelta(a, b, track.length);
  if (Math.abs(along) > 10 || Math.abs(a.offset - b.offset) > 4) return null;
  const pa = pose(a, track), pb = pose(b, track);
  if (Math.abs(pa.y - pb.y) > 2.5) return null;
  let deepest = null;
  for (const frontA of [-1, 1]) for (const frontB of [-1, 1]) {
    const ax = pa.x + pa.fx * PHYSICS.bodyHalfSpan * frontA;
    const az = pa.z + pa.fz * PHYSICS.bodyHalfSpan * frontA;
    const bx = pb.x + pb.fx * PHYSICS.bodyHalfSpan * frontB;
    const bz = pb.z + pb.fz * PHYSICS.bodyHalfSpan * frontB;
    const dx = bx - ax, dz = bz - az;
    const distance = Math.hypot(dx, dz);
    const penetration = PHYSICS.bodyRadius * 2 - distance;
    if (penetration <= 0 || (deepest && deepest.penetration >= penetration)) continue;
    // Consistent axis for exactly coincident starts avoids jitter/randomness.
    const fallback = String(a.id) < String(b.id) ? 1 : -1;
    deepest = { nx: distance > 1e-7 ? dx / distance : fallback, nz: distance > 1e-7 ? dz / distance : 0, penetration, pa, pb };
  }
  return deepest;
}

export function solveKartCollisions(racers, track) {
  const impacts = new Map();
  for (let iteration = 0; iteration < PHYSICS.solverIterations; iteration++) {
    for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i], b = racers[j];
      if (a.finished || b.finished) continue;
      const contact = kartContact(a, b, track);
      if (!contact) continue;
      const { nx, nz, penetration, pa, pb } = contact;
      const correction = Math.max(0, penetration - PHYSICS.contactSlop) * 0.48;
      a.offset -= (nx * pa.nx + nz * pa.nz) * correction;
      a.distance -= (nx * pa.tx + nz * pa.tz) * correction / pa.metric;
      b.offset += (nx * pb.nx + nz * pb.nz) * correction;
      b.distance += (nx * pb.tx + nz * pb.tz) * correction / pb.metric;
      a.lateralVelocity ||= 0; b.lateralVelocity ||= 0;
      let avx = pa.tx * a.speed + pa.nx * a.lateralVelocity, avz = pa.tz * a.speed + pa.nz * a.lateralVelocity;
      let bvx = pb.tx * b.speed + pb.nx * b.lateralVelocity, bvz = pb.tz * b.speed + pb.nz * b.lateralVelocity;
      const relativeX = bvx - avx, relativeZ = bvz - avz;
      const closing = relativeX * nx + relativeZ * nz;
      if (closing >= -0.005) continue;
      const energyBefore = kineticEnergy(a) + kineticEnergy(b);
      const impulse = -(1 + PHYSICS.restitution) * closing * 0.5;
      const tx = nz, tz = -nx;
      const tangential = relativeX * tx + relativeZ * tz;
      const friction = clamp(-tangential * 0.5, -impulse * PHYSICS.collisionFriction, impulse * PHYSICS.collisionFriction);
      const ix = impulse * nx + friction * tx, iz = impulse * nz + friction * tz;
      avx -= ix; avz -= iz; bvx += ix; bvz += iz;
      a.lateralVelocity = avx * pa.nx + avz * pa.nz; a.speed = Math.max(0, avx * pa.tx + avz * pa.tz);
      b.lateralVelocity = bvx * pb.nx + bvz * pb.nz; b.speed = Math.max(0, bvx * pb.tx + bvz * pb.tz);
      // Numerical safety for a tightly packed group: contacts never add energy.
      const energyAfter = kineticEnergy(a) + kineticEnergy(b);
      if (energyAfter > energyBefore && energyAfter > 0) {
        const scale = Math.sqrt(energyBefore / energyAfter);
        a.speed *= scale; a.lateralVelocity *= scale; b.speed *= scale; b.lateralVelocity *= scale;
      }
      const key = `${i}:${j}`;
      if (!impacts.has(key)) impacts.set(key, { a, b, impact: -closing });
      else impacts.get(key).impact = Math.max(impacts.get(key).impact, -closing);
    }
    for (const racer of racers) resolveRailCollision(racer, track);
  }
  return [...impacts.values()];
}
