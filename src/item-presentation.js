// Shared labels and small vector artwork keep the item slot and touch key legible.
export const ITEM_PRESENTATION = Object.freeze({
  rocket: { name: '火箭冲刺', short: '冲刺', color: '#ffad60', description: '短时加速，直道和出弯时使用', path: '<path d="M13 4c4-2 9-2 11-1 1 3 0 8-3 12l-5 5-7-7Z"/><path d="m10 13-5 1-2 6 7-1m7 0-1 7 6-3 1-6M9 23l-5 5m2-8-3 3m10 3-3 3"/><circle cx="19" cy="8" r="2"/>' },
  shield: { name: '泡泡护盾', short: '护盾', color: '#79dcea', description: '抵挡一次道具攻击，减轻碰撞', path: '<path d="M16 3 27 7v8c0 7-7 12-11 14C12 27 5 22 5 15V7Z"/><path d="m11 16 4 4 7-9"/>' },
  magnet: { name: '能量磁铁', short: '磁铁', color: '#f09acf', description: '扩大氮气晶体的收集范围', path: '<path d="M5 5h7v12a4 4 0 0 0 8 0V5h7v12a11 11 0 0 1-22 0Z"/><path d="M5 11h7m8 0h7m-9-8 1-2m11 11 2-1M1 11l2 1"/>' },
  bubble: { name: '泡泡弹', short: '泡泡弹', color: '#8fb9ff', description: '向前发射，短暂减慢前方赛车', path: '<circle cx="19" cy="12" r="9"/><path d="M15 7a6 6 0 0 1 6-1M4 20l6-6m-8 3 4-4m2 15 6-6"/><circle cx="24" cy="25" r="3"/>' },
  jelly: { name: '果冻陷阱', short: '果冻', color: '#ad9bec', description: '在身后留下可见果冻，干扰追车', path: '<path d="M6 15c0-7 4-12 10-12s10 5 10 12l3 9c0 4-7 5-13 5S3 28 3 24Z"/><path d="M9 9c1-2 3-3 5-3M4 22c4 3 20 3 24 0"/><circle cx="12" cy="16" r="1"/><circle cx="20" cy="16" r="1"/>' },
});

export function itemIcon(type, className = '') {
  const item = ITEM_PRESENTATION[type];
  return item ? `<svg class="${className}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.path}</svg>` : '';
}
