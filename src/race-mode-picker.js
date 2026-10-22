const MODES = {
  race: { name: '竞速赛', icon: '⚑', detail: '漂移与氮气决胜 · 专注过弯和路线' },
  items: { name: '道具赛', icon: '✦', detail: '收集五种道具 · 按键使用，一起欢乐追逐' },
};

export class RaceModePicker {
  constructor(root, { onChange = () => {}, mode = 'race' } = {}) {
    this.onChange = onChange;
    this.element = document.createElement('section');
    this.element.className = 'race-mode-picker';
    this.element.setAttribute('aria-label', '选择比赛类型');
    this.element.innerHTML = `<div class="section-label">这次，怎么玩？</div><div class="race-mode-options" role="group" aria-label="比赛类型">${Object.entries(MODES).map(([id, value]) => `<button type="button" data-race-mode="${id}" aria-pressed="false"><span aria-hidden="true">${value.icon}</span>${value.name}</button>`).join('')}</div><p class="race-mode-detail"></p>`;
    root.querySelector('.start-actions').before(this.element);
    this.element.querySelectorAll('[data-race-mode]').forEach(button => button.addEventListener('click', () => this.setMode(button.dataset.raceMode, true)));
    this.setMode(mode);
  }
  setMode(mode, notify = false) {
    this.mode = MODES[mode] ? mode : 'race';
    this.element.querySelectorAll('[data-race-mode]').forEach(button => {
      const selected = button.dataset.raceMode === this.mode;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('selected', selected);
    });
    this.element.querySelector('.race-mode-detail').textContent = MODES[this.mode].detail;
    if (notify) this.onChange(this.mode);
  }
}
