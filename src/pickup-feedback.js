const EFFECTS = [
  { id: 'shield', icon: '◉', name: '泡泡护盾' },
  { id: 'magnet', icon: '∩', name: '能量磁铁' },
  { id: 'rocket', icon: '↟', name: '火箭冲刺' },
];

export class PickupFeedback {
  constructor(root) {
    this.root = root;
    this.nitro = root.querySelector('.nitro-panel');
    this.panel = document.createElement('div');
    this.panel.className = 'item-effects'; this.panel.setAttribute('aria-label', '生效中的道具');
    this.chips = EFFECTS.map(effect => {
      const chip = document.createElement('span'); chip.className = `item-effect item-${effect.id}`; chip.hidden = true;
      const label = document.createElement('strong'); label.textContent = `${effect.icon} ${effect.name}`;
      const time = document.createElement('span'); chip.append(label, time); this.panel.append(chip);
      return { ...effect, chip, time };
    });
    root.querySelector('.race-hud').append(this.panel);
    this.gain = document.createElement('span'); this.gain.className = 'energy-gain'; this.gain.setAttribute('aria-hidden', 'true');
    this.nitro.append(this.gain);
    const help = document.createElement('p'); help.className = 'pickup-help';
    help.textContent = '金色晶体补充氮气，拾取后本圈消失。道具赛经过彩色箱子收集道具，每次携带一个：冲刺、护盾、磁铁、泡泡弹或果冻陷阱。电脑按道具键（默认 E），手机轻点 ✦ 道具按钮使用；可在设置中改键或拖动按钮。受击短暂减速后有保护期，转向和刹车保持可用。竞速赛和计时挑战没有道具箱。';
    root.querySelector('.help-dialog').append(help);
    // Reflow only when HUD geometry changes, never on every rendered frame.
    this.scheduleLayout=()=>{
      if(this.layoutFrame)return;
      this.layoutFrame=requestAnimationFrame(()=>{
        this.layoutFrame=0;
        const lap=root.querySelector('.lap-panel').getBoundingClientRect();
        const auto=root.querySelector('.auto-throttle-button').getBoundingClientRect();
        const app=root.getBoundingClientRect(),inventory=root.querySelector('.inventory-panel');
        const compact=root.dataset.inputMode==='touch'&&app.width>app.height&&app.width<=1024&&app.height<=560;
        const anchor=compact&&inventory&&!inventory.hidden?inventory.getBoundingClientRect().bottom:Math.max(lap.bottom,auto.bottom);
        if(lap.height||auto.height)this.panel.style.top=`${anchor-app.top+8}px`;
      });
    };
    if(globalThis.ResizeObserver){this.layoutObserver=new ResizeObserver(this.scheduleLayout);for(const element of [root.querySelector('.lap-panel'),root.querySelector('.auto-throttle-button'),root.querySelector('.inventory-panel'),this.panel].filter(Boolean))this.layoutObserver.observe(element);}
    window.addEventListener('resize',this.scheduleLayout);
    root.addEventListener('inputmodechange',this.scheduleLayout);
    this.scheduleLayout();
  }
  event(event) {
    if (event.type !== 'energy') return;
    const amount=Number.isFinite(event.amount)?event.amount:8;
    this.gain.textContent = amount>0?`+${Number(amount.toFixed(1))}`:'MAX';
    this.nitro.classList.remove('energy-collected');
    // Restart the short animation even for closely spaced crystals.
    void this.nitro.offsetWidth;
    this.nitro.classList.add('energy-collected');
  }
  update(race) {
    for (const { id, chip, time } of this.chips) {
      const remaining = Math.max(0, Number(race.player[id]) || 0);
      chip.hidden = race.mode !== 'items' || remaining <= 0 || !['countdown', 'racing', 'paused'].includes(race.phase);
      const text = `${remaining.toFixed(1)}s`;
      if (time.textContent !== text) time.textContent = text;
    }
  }
  reset() { this.nitro.classList.remove('energy-collected'); for (const { chip } of this.chips) chip.hidden = true; }
}
