import { createMapStrategies } from './map-strategies.js';

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

export const DEFAULT_TRACK_ID = 'sunny-island';
export const TRACK_CATALOG = Object.freeze([
  { id: DEFAULT_TRACK_ID, name: '晴空大环岛', subtitle: '海风、森林与小镇，一圈环游晴空。', description: '穿越五种风景，在长桥和山间弯道练习漂移。', difficulty: '标准', theme: DEFAULT_TRACK_ID, color: '#4cbfca', english: 'SUNSHINE ISLAND', feature: '海岛环游 · 经典全能' },
  { id: 'candy-hills', name: '糖果丘陵', subtitle: '绕过奶油山丘，把每个弯开成甜甜圈。', description: '圆润的花瓣弯与缓缓起伏，沿糖果能量线寻找连续小喷的节奏。', difficulty: '轻松', theme: 'candy-hills', color: '#e99eb5', english: 'CANDY HILLS', feature: '花瓣连弯 · 起伏追风' },
  { id: 'bay-loop', name: '晴风海湾', subtitle: '把氮气留给长直道，向着海平线出发。', description: '高速长直道连接宽缓回头弯，跨过海湾长桥后再来一次全速冲刺。', difficulty: '入门', theme: 'bay-loop', color: '#49b9d1', english: 'BREEZY BAY', feature: '高速海湾 · 氮气冲刺' },
  { id: 'starlight-canyon', name: '星光峡谷', subtitle: '跟着星光连续漂移，穿过紫色峡谷。', description: '四组方向交替的峡谷弯道，挑战找准漂移时机与出弯加速。', difficulty: '进阶', theme: 'starlight-canyon', color: '#a89cdd', english: 'STARLIGHT CANYON', feature: '星光 S 弯 · 漂移挑战' },
].map(entry => Object.freeze(entry)));

// Polar control points keep each playful lobed circuit a simple closed loop.
// Their smooth, low-amplitude elevation never creates a blind jump or drop.
function petalControls(count, rx, rz, lobes, depth, elevation, amplitude) {
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + i / count * Math.PI * 2;
    const radius = 1 + depth * Math.cos(lobes * (a + Math.PI / 2));
    return [Math.cos(a) * rx * radius, Math.sin(a) * rz * radius, elevation + amplitude * (1 - Math.cos(a * 2 + Math.PI)) / 2];
  });
}

const routes = {
  [DEFAULT_TRACK_ID]: { controls, zones: zoneDefinitions, boosts: [.045, .135, .245, .365, .515, .655, .755, .895, .965] },
  'candy-hills': {
    controls: petalControls(36, 295, 245, 3, .12, 9, 13),
    zones: [
      ['糖霜起跑线', 'coast', '#f0acb8', '糖果大道 · 甜蜜出发'],
      ['棉花糖树林', 'forest', '#a8d8b0', '圆润连弯 · 跟紧节奏'],
      ['奶油小山丘', 'mountain', '#d4addf', '缓坡追风 · 抬头看云'],
      ['饼干云桥', 'bridge', '#c5b9e8', '跨越糖河 · 连续小喷'],
      ['甜甜圈小镇', 'village', '#ecb987', '糖粒直道 · 冲线欢呼'],
    ],
    boosts: [.045, .145, .255, .345, .445, .545, .645, .745, .845, .945],
    coinGroups: 36, coinStyle: 'wave',
  },
  'bay-loop': {
    controls: [
      [-180, -248, 7], [-50, -250, 7], [100, -250, 7], [235, -238, 8],
      [320, -180, 9], [347, -65, 11], [325, 62, 13], [263, 162, 16],
      [163, 227, 18], [30, 245, 19], [-110, 244, 19], [-240, 218, 19],
      [-320, 152, 18], [-349, 50, 17], [-337, -61, 14], [-288, -170, 10],
    ],
    zones: [
      ['海风直道', 'coast', '#52c4d8', '长直道 · 氮气全开'],
      ['椰林大回弯', 'forest', '#6cc7a1', '宽缓大弯 · 把握切线'],
      ['望海缓坡', 'mountain', '#a2cbdc', '抬升海岸 · 看见远帆'],
      ['珊瑚跨海桥', 'bridge', '#73c9e7', '蓝色长桥 · 向海冲刺'],
      ['灯塔港湾', 'village', '#f1c584', '港湾回程 · 再次加速'],
    ],
    boosts: [.03, .065, .1, .28, .42, .49, .54, .72, .77, .89, .955],
    coinGroups: 32, coinStyle: 'sweep',
  },
  'starlight-canyon': {
    controls: petalControls(48, 290, 240, 4, .25, 12, 13),
    zones: [
      ['星尘出发台', 'coast', '#aaa4e4', '星光大道 · 追上夜风'],
      ['发光蘑菇林', 'forest', '#7abdbb', '紫色连弯 · 留住漂移'],
      ['紫晶 S 峡谷', 'mountain', '#b293db', '左右换向 · 连续挑战'],
      ['银河天桥', 'bridge', '#8ba9e5', '跨越星河 · 抓住加速'],
      ['月亮驿站', 'village', '#d0a5cc', '最后一弯 · 星光冲线'],
    ],
    boosts: [.065, .19, .315, .44, .565, .69, .815, .94],
    coinGroups: 40, coinStyle: 'wave',
  },
};

function routeZones(definition) {
  if (definition === routes[DEFAULT_TRACK_ID]) return zoneDefinitions;
  const boundaries = [0, .245, .405, .695, .84, 1];
  return definition.zones.map(([name, kind, color, subtitle], index) => ({ id: kind, name, kind, color, subtitle, from: boundaries[index], to: boundaries[index + 1] }));
}

function catmull(a, b, c, d, t) {
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}

export function createTrack(id = DEFAULT_TRACK_ID) {
  const metadata = TRACK_CATALOG.find(entry => entry.id === id);
  if (!metadata) throw new RangeError(`Unknown track: ${String(id)}`);
  const definition = routes[id], controls = definition.controls;
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
  const zones = routeZones(definition).map(z => ({ ...z, start: z.from * length, end: z.to * length }));
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
  const boostPads = definition.boosts.map((u, index) => ({ id: `boost-${index}`, distance: u * length, lane: index % 3 === 0 ? -2.5 : 2.5 }));
  const coinGroups = definition.coinGroups ?? 32;
  const coins = Array.from({ length: coinGroups }, (_, i) => [0, 4.5, 9].map((gap, j) => {
    const lane = definition.coinStyle === 'wave' ? Math.sin((i * 3 + j) * .38) * 3.6 : definition.coinStyle === 'sweep' ? (i % 4 < 2 ? -2.7 : 2.7) : i % 2 ? -2.4 : 2.4;
    return { id: `energy-${i}-${j}`, distance: (i + .5) / coinGroups * length + gap, lane };
  })).flat();
  const strategies = createMapStrategies(id, length, sample);
  return { ...metadata, length, width: 16, railOffset: 11, sample, points, controlPoints: controls.map(p => [p[0], p[1]]), bounds, mapScale: Math.max(bounds.width, bounds.depth), zones, zoneAt, boostPads, coins, energyCrystals: coins, itemBoxes: [], ...strategies };
}

export const track = createTrack();
