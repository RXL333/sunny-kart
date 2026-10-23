// These are alternate racing lines on the existing road, never hidden progress
// skips. The centre lane stays neutral and every benefit has a visible cost.
export const STRATEGY_COLORS = Object.freeze({ energy: '#65dfc1', sprint: '#ffc16a' });

const PLANS = {
  'sunny-island': [
    { from: .185, metres: 78, name: '椰风长弯', hint: '内线耗能抢位，外线连续漂移补能。', kind: 'drift', energyRate: 7, cost: 6 },
    { from: .415, metres: 72, name: '云顶弧线', hint: '外线漂移蓄力，出弯再切入抢位。', kind: 'drift', energyRate: 8, cost: 7 },
    { from: .714, metres: 76, name: '浮光连弯', hint: '保留漂移节奏，选择补能或内线突破。', kind: 'drift', energyRate: 7, cost: 6 },
  ],
  'candy-hills': [
    { from: .115, metres: 58, name: '糖粒上坡', hint: '绿色短带分三拍补能，橙色长带平顺耗能加速。', kind: 'rhythm', energyRate: 12, cost: 7 },
    { from: .425, metres: 58, name: '奶油节拍', hint: '沿短带把握补能节奏，或用氮气换稳定速度。', kind: 'rhythm', energyRate: 12, cost: 7 },
    { from: .735, metres: 58, name: '甜甜圈三拍', hint: '三段补能留给下一弯，长带冲刺争取当前名次。', kind: 'rhythm', energyRate: 12, cost: 8 },
  ],
  'bay-loop': [
    { from: .08, metres: 80, name: '海风双线', hint: '宽绿线稳稳补能，窄橙线耗氮抢直道。', kind: 'narrow', energyRate: 4.5, cost: 10 },
    { from: .555, metres: 88, name: '望海冲刺', hint: '快线入口较窄，提前对准；中线始终可以通行。', kind: 'narrow', energyRate: 4.5, cost: 11 },
    { from: .875, metres: 78, name: '灯塔突破口', hint: '宽线准备下一圈，窄线消耗氮气争取冲线。', kind: 'narrow', energyRate: 4.5, cost: 10 },
  ],
  'starlight-canyon': [
    { from: .235, metres: 54, name: '星尘储备', hint: '先在绿线补能，为后段银河快线保留氮气。', kind: 'reserve', energyRate: 9, cost: 8 },
    { from: .612, metres: 56, name: '紫晶蓄能弯', hint: '连弯补足氮气，别在这里用光储备。', kind: 'reserve', energyRate: 9, cost: 8 },
    { from: .858, metres: 76, name: '银河终段', hint: '橙线高耗氮冲刺；氮气耗尽后回归普通速度。', kind: 'finale', energyRate: 4, cost: 15 },
  ],
};

export function createMapStrategies(id, length, sample) {
  const sections = [], zones = [];
  for (const [index, plan] of (PLANS[id] ?? []).entries()) {
    const start = plan.from * length, end = Math.min(length, start + plan.metres);
    const curve = sample(start + plan.metres / 2).curvature;
    const inner = curve > 0 ? 1 : -1;
    const side = plan.kind === 'drift' || plan.kind === 'reserve' ? inner : index % 2 ? -1 : 1;
    const sectionId = `${id}-choice-${index + 1}`;
    const energy = {
      id: `${sectionId}-energy`, sectionId, label: plan.kind === 'rhythm' ? '三拍补能线' : plan.kind === 'drift' ? '外线补能' : plan.kind === 'narrow' ? '宽线补能' : '储备补能线',
      kind: 'energy', start, end, lane: -side * 3.9, halfWidth: plan.kind === 'narrow' ? 2.15 : 1.75,
      speedFactor: plan.kind === 'narrow' ? .96 : plan.kind === 'rhythm' ? .89 : .92,
      nitroRate: plan.energyRate, color: STRATEGY_COLORS.energy,
      description: plan.kind === 'rhythm' ? '三段绿色短带：略微减速，快速补充氮气。' : '绿色宽带：略微减速，补充氮气。',
      ...(plan.kind === 'drift' ? { driftChargeFactor: 1.14 } : {}),
    };
    if (plan.kind === 'rhythm') {
      energy.segments = Object.freeze([0, 21, 42].map(gap => Object.freeze({ start: start + gap, end: Math.min(end, start + gap + 11) })));
    }
    const sprint = {
      id: `${sectionId}-sprint`, sectionId, label: plan.kind === 'finale' ? '银河高耗快线' : plan.kind === 'narrow' ? '窄道冲刺' : plan.kind === 'drift' ? '内线抢位' : '耗能快线',
      kind: 'sprint', start, end, lane: side * (plan.kind === 'narrow' ? 4.65 : 3.9), halfWidth: plan.kind === 'narrow' ? .95 : 1.35,
      speedFactor: plan.kind === 'finale' ? 1.10 : plan.kind === 'narrow' ? 1.09 : plan.kind === 'reserve' ? 1.045 : plan.kind === 'drift' ? 1.055 : 1.065,
      nitroRate: -plan.cost, color: STRATEGY_COLORS.sprint,
      description: plan.kind === 'narrow' ? '橙色窄带：需要对准入口，持续耗氮加速。' : '橙色带：持续耗氮加速，无氮气时恢复普通速度。',
    };
    zones.push(Object.freeze(energy), Object.freeze(sprint));
    sections.push(Object.freeze({ id: sectionId, label: plan.name, description: plan.hint, kind: plan.kind, start, end, choices: Object.freeze([energy, sprint]) }));
  }
  Object.freeze(zones); Object.freeze(sections);
  const strategyAt = (distance, offset) => {
    if (!Number.isFinite(distance) || !Number.isFinite(offset) || !(length > 0)) return null;
    const d = ((distance % length) + length) % length;
    for (const zone of zones) {
      if (d < zone.start || d >= zone.end || Math.abs(offset - zone.lane) > zone.halfWidth) continue;
      if (zone.segments && !zone.segments.some(segment => d >= segment.start && d < segment.end)) continue;
      return zone;
    }
    return null;
  };
  return { strategyZones: zones, strategySections: sections, strategyAt };
}
