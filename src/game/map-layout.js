// The spatial road index keeps large terrain queries local and deterministic.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const hill = (x, z, cx, cz, radius, height) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (radius * radius)) * height;

export function createTerrainSampler(track) {
  const cell = 36, grid = new Map(), points = track.points;
  const key = (x, z) => `${x},${z}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell), z0 = Math.floor(Math.min(a.z, b.z) / cell), z1 = Math.floor(Math.max(a.z, b.z) / cell);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  }
  const nearest = (x, z) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let min = Infinity, best = null, candidates = new Set();
    for (let ring = 0; ring <= 12; ring++) {
      for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++) { if (ring > 0 && Math.abs(a) !== ring && Math.abs(b) !== ring) continue; for (const i of grid.get(key(cx + a, cz + b)) || []) candidates.add(i); }
      if (candidates.size && ring >= 1) {
        for (const i of candidates) {
          const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
          const px = mix(a.x, b.x, t), pz = mix(a.z, b.z, t), d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < min) { min = d; best = { x: px, y: mix(a.y, b.y, t), z: pz, distance: mix(a.distance, b.distance, t) }; }
        }
        candidates.clear();
        if (Math.sqrt(min) < (ring - 1) * cell) break;
        if (ring >= 2 && best) break;
      }
    }
    return { d: Math.sqrt(min), p: best || { ...points[0] } };
  };
  const terrainHeight = (x, z, knownNear) => {
    const radius = Math.sqrt(((x + 5) / 403) ** 2 + ((z - 7) / 348) ** 2), coast = radius + .035 * Math.sin(x * .025) * Math.cos(z * .021);
    let height = 7.5 + Math.sin(x * .017) * Math.cos(z * .019) * 3.3;
    height += hill(x, z, 80, 118, 112, 26) + hill(x, z, -69, 65, 105, 20) + hill(x, z, -168, 130, 76, 12);
    height = mix(height, -5, smooth(coast, .75, 1.065));
    const near = knownNear || nearest(x, z), d = near.p.distance / track.length;
    const bridge = smooth(d, .705, .735) * (1 - smooth(d, .8, .835));
    if (bridge > 0) height = mix(height, -3, bridge * (1 - smooth(near.d, 35, 90)));
    // Eighteen metres includes one complete terrain-cell diagonal beyond the
    // driving surface, preventing coarse terrain triangles clipping the road.
    if (near.d < 42 && bridge < .15) height = mix(near.p.y - .25, height, smooth(near.d, 18, 42));
    return height;
  };
  return { nearest, terrainHeight, cellSize: cell };
}

export const MAP_LAYOUT = {
  terrain: { width: 930, depth: 820, chunksX: 4, chunksZ: 4, segments: 44 },
  peaks: [[-15, 66, 31, 78, 0x80bca3], [74, 132, 38, 95, 0xa3c6b2], [-112, 82, 28, 66, 0x72b69f], [118, 87, 26, 62, 0xaccfae], [-84, -29, 25, 55, 0x9bcaab]],
  distantPeaks: [[-600, 170, 95, 175], [-490, 480, 100, 205], [515, 380, 120, 190], [650, -70, 100, 145], [130, 630, 145, 220]],
};
