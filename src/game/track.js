// Horizontal metres, elevation, and road curvature share one continuous frame.
const mod = (a, n) => ((a % n) + n) % n;
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const controls = [
  [-130, -240, 6], [-10, -247, 6], [125, -240, 6.5], [250, -220, 7],
  [309, -142, 9], [315, -50, 11], [274, 22, 14], [205, 61, 18],
  [230, 123, 22], [295, 177, 25], [253, 234, 26], [132, 263, 26],
  [65, 231, 23], [5, 170, 19], [-55, 185, 18], [-129, 251, 18],
  [-244, 226, 17], [-310, 135, 14], [-309, 22, 10], [-249, -50, 8],
  [-262, -129, 10], [-219, -208, 8],
];
const zoneDefinitions = [
  { id: 'coast', name: '晴风海岸', from: 0, to: .245, color: '#4cbfca', kind: 'coast', subtitle: '海滨高速 · 向着日光' },
  { id: 'forest', name: '薄荷森林', from: .245, to: .405, color: '#66b877', kind: 'forest', subtitle: '林荫弯道 · 穿过绿意' },
  { id: 'mountain', name: '云顶山道', from: .405, to: .695, color: '#a49ac4', kind: 'mountain', subtitle: '山间 S 弯 · 起伏追风' },
  { id: 'bridge', name: '浮光海湾', from: .695, to: .84, color: '#6eafda', kind: 'bridge', subtitle: '跨海长桥 · 把风甩在身后' },
  { id: 'village', name: '橘子小镇', from: .84, to: 1, color: '#eaaa67', kind: 'village', subtitle: '港湾回程 · 冲向欢呼' },
];

function catmull(a, b, c, d, t) {
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}

export function createTrack() {
  const raw = [];
  const count = 6600;
  let length = 0;
  for (let i = 0; i <= count; i++) {
    const u = (i / count) * controls.length;
    const k = Math.floor(u), t = u - k;
    const p = [-1, 0, 1, 2].map(d => controls[mod(k + d, controls.length)]);
    const x = catmull(...p.map(q => q[0]), t);
    const z = catmull(...p.map(q => q[1]), t);
    const y = catmull(...p.map(q => q[2]), t);
    if (i) length += Math.hypot(x - raw[i - 1].x, z - raw[i - 1].z);
    raw.push({ x, y, z, distance: length });
  }
  const zones = zoneDefinitions.map(z => ({ ...z, start: z.from * length, end: z.to * length }));
  const zoneAt = distance => { const d = mod(distance, length); return zones.find(z => d >= z.start && d < z.end) || zones[0]; };

  const at = distance => {
    const d = mod(distance, length);
    let lo = 0, hi = raw.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (raw[mid].distance <= d) lo = mid; else hi = mid;
    }
    const a = raw[lo], b = raw[hi];
    const t = (d - a.distance) / Math.max(0.00001, b.distance - a.distance);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  };

  const frame = distance => {
    const a = at(distance - .7), b = at(distance + .7);
    const h = Math.max(.000001, Math.hypot(b.x - a.x, b.z - a.z));
    const tx = (b.x - a.x) / h, tz = (b.z - a.z) / h;
    return { tx, tz, nx: tz, nz: -tx, heading: Math.atan2(tx, tz), slope: (b.y - a.y) / h };
  };
  const sample = distance => { const p = at(distance), f = frame(distance); return { ...p, ...f, curvature: angle(frame(distance + 1.5).heading - frame(distance - 1.5).heading) / 3, pitch: Math.atan(f.slope), width: 16, zone: zoneAt(distance) }; };
  const pointCount = Math.ceil(length / 2);
  const points = Array.from({ length: pointCount + 1 }, (_, i) => ({ distance: i * length / pointCount, ...sample(i * length / pointCount) }));
  const minX = Math.min(...raw.map(p => p.x)), maxX = Math.max(...raw.map(p => p.x)), minZ = Math.min(...raw.map(p => p.z)), maxZ = Math.max(...raw.map(p => p.z));
  const bounds = { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, centerX: (maxX + minX) / 2, centerZ: (maxZ + minZ) / 2 };
  const boostPads = [.045, .135, .245, .365, .515, .655, .755, .895, .965].map((u, id) => ({ id: `boost-${id}`, distance: u * length, lane: id % 3 === 0 ? -2.5 : 2.5 }));
  const coins = Array.from({ length: 32 }, (_, i) => [0, 4.5, 9].map((gap, j) => ({ id: `energy-${i}-${j}`, distance: (i + .5) / 32 * length + gap, lane: i % 2 ? -2.4 : 2.4 }))).flat();
  return { name: '晴空大环岛', length, width: 16, railOffset: 11, sample, points, controlPoints: controls.map(p => [p[0], p[1]]), bounds, mapScale: Math.max(bounds.width, bounds.depth), zones, zoneAt, boostPads, coins, energyCrystals: coins, itemBoxes: [] };
}

export const track = createTrack();
