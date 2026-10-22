import { ITEM_PRESENTATION, itemIcon } from './item-presentation.js';
import { keyLabel } from './keyboard-bindings.js';

export class ItemHUD {
  constructor(root) {
    this.root = root;
    this.element = document.createElement('div');
    this.element.className = 'inventory-panel';
    this.element.hidden = true;
    this.element.setAttribute('aria-label', '持有道具');
    this.element.innerHTML = '<span class="inventory-art" aria-hidden="true">?</span><div><small>道具槽 · 1 / 1</small><strong class="inventory-name">等待拾取</strong><span class="inventory-instruction">经过彩色道具箱收集</span></div><kbd class="inventory-key">E</kbd>';
    root.querySelector('.race-hud').append(this.element);
    this.button = root.querySelector('[data-touch="useItem"]');
    this.lastType = undefined;
    this.scheduleLayout = () => {
      const view = root.ownerDocument.defaultView;
      if (this.layoutFrame || !view.requestAnimationFrame) return;
      this.layoutFrame = view.requestAnimationFrame(() => {
        this.layoutFrame = 0;
        const position = root.querySelector('.position-panel')?.getBoundingClientRect();
        const app = root.getBoundingClientRect();
        if (position?.height) this.element.style.top = `${position.bottom - app.top + 8}px`;
      });
    };
    const view = root.ownerDocument.defaultView;
    if (view.ResizeObserver) { this.observer = new view.ResizeObserver(this.scheduleLayout); this.observer.observe(root); }
    view.addEventListener('resize', this.scheduleLayout);
    root.addEventListener('inputmodechange', this.scheduleLayout);
  }
  setBindings(bindings) {
    const keys = (bindings.useItem || ['KeyE']).map(keyLabel).join(' / ');
    this.element.querySelector('.inventory-key').textContent = keys;
    this.keys = keys;
  }
  update(race) {
    const enabled = race.mode === 'items';
    this.element.hidden = !enabled;
    this.root.classList.toggle('item-race', enabled);
    if (this.button) this.button.hidden = !enabled;
    const type = race.player?.inventory || null;
    const item = ITEM_PRESENTATION[type];
    if (type === this.lastType && enabled === this.lastEnabled) return;
    this.lastType = type;
    this.lastEnabled = enabled;
    this.scheduleLayout();
    this.element.classList.toggle('has-item', Boolean(item));
    this.element.style.setProperty('--item-color', item?.color || '#d7dedc');
    this.element.querySelector('.inventory-art').innerHTML = item ? itemIcon(type) : '?';
    this.element.querySelector('.inventory-name').textContent = item?.name || '等待拾取';
    this.element.querySelector('.inventory-instruction').textContent = item ? '按道具键使用 · 可保留到合适时机' : '经过彩色道具箱收集';
    if (this.button) {
      this.button.innerHTML = item ? itemIcon(type) : '<span aria-hidden="true">✦</span><small>道具</small>';
      this.button.classList.toggle('has-item', Boolean(item));
      this.button.setAttribute('aria-label', item ? `使用${item.name}` : '使用道具，当前道具槽为空');
      this.button.setAttribute('aria-disabled', String(!item));
      this.button.style.setProperty('--item-color', item?.color || '#d7dedc');
    }
  }
}
