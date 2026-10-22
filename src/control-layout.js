export const CONTROL_LAYOUT_STORAGE_KEY = 'sunny-touch-layout-v2';
export const LEGACY_CONTROL_LAYOUT_STORAGE_KEY = 'sunny-touch-layout-v1';
export const CONTROL_ACTIONS = Object.freeze(['left', 'right', 'drift', 'nitro', 'brake', 'throttle', 'useItem']);
const legacyActions = CONTROL_ACTIONS.filter(action => action !== 'useItem');
const labels = { left: '◀ 左转', right: '右转 ▶', drift: '漂移', nitro: '⚡ 氮气', brake: '刹车', throttle: '油门', useItem: '使用道具' };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const emptyLayouts = () => ({ version: 2, landscape: null, portrait: null });
export const layoutOrientation = (width, height) => width > height ? 'landscape' : 'portrait';

/** Positions are viewport-relative centres, never raw CSS or arbitrary storage keys. */
export function validateControlLayouts(value) {
  const result = emptyLayouts();
  if (!record(value)) return result;
  for (const orientation of ['landscape', 'portrait']) {
    const source = Object.hasOwn(value, orientation) && value[orientation];
    if (!record(source)) continue;
    const positions = {};
    for (const action of legacyActions) {
      const point = Object.hasOwn(source, action) && source[action];
      if (!record(point) || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) break;
      positions[action] = { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
    }
    if (Object.keys(positions).length !== legacyActions.length) continue;
    // Old six-button layouts remain complete. Add the new button only after
    // viewport bounds are known, without changing any of the saved six points.
    if (Object.hasOwn(source, 'useItem')) {
      const point = source.useItem;
      if (record(point) && typeof point.x === 'number' && typeof point.y === 'number' && Number.isFinite(point.x) && Number.isFinite(point.y))
        positions.useItem = { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
    }
    result[orientation] = positions;
  }
  return result;
}

export function readControlLayouts(storage) {
  try {
    const saved = storage?.getItem(CONTROL_LAYOUT_STORAGE_KEY);
    // In particular, a deliberately empty v2 layout must not revive v1 data.
    if (saved !== null && saved !== undefined) return validateControlLayouts(JSON.parse(saved));
    return validateControlLayouts(JSON.parse(storage?.getItem(LEGACY_CONTROL_LAYOUT_STORAGE_KEY) || 'null'));
  }
  catch { return emptyLayouts(); }
}

export function saveControlLayouts(storage, layouts) {
  try {
    if (typeof storage?.setItem !== 'function') return false;
    storage.setItem(CONTROL_LAYOUT_STORAGE_KEY, JSON.stringify(validateControlLayouts(layouts)));return true;
  }
  catch { return false; }
}

/** Use the same safe bounds for the editor and live controls, including after rotation. */
export function controlGeometry({ width, height, size = 64, safe = {}, toolbar = 128 }) {
  width = Math.max(1, Number(width) || 1);height = Math.max(1, Number(height) || 1);
  if (width <= 600 && height >= width) toolbar = Math.max(toolbar, 170);
  const left = Math.max(12, Number(safe.left) || 0), right = Math.max(12, Number(safe.right) || 0);
  const top = Math.max(toolbar, Number(safe.top) || 0), bottom = Math.max(12, Number(safe.bottom) || 0);
  size = clamp(Number(size) || 64, 44, 84);
  size = Math.min(size, Math.max(24, (width - left - right - 32) / 4), Math.max(24, (height - top - bottom - 12) / 2));
  const minX = Math.min(width / 2, left + size / 2), maxX = Math.max(minX, width - right - size / 2);
  const minY = Math.min(height / 2, top + size / 2), maxY = Math.max(minY, height - bottom - size / 2);
  return { width, height, size, minX, maxX, minY, maxY };
}

// Rectangle boundaries enumerate every possible free region, so this search
// finds a gap without a per-pixel scan or moving the six established controls.
function availableItemPosition(preferred, positions, size, itemSize, bounds) {
  const others = legacyActions.map(action => positions[action]);
  const distance = (size + itemSize) / 2 + 3;
  const xs = new Set([bounds.minX, bounds.maxX, clamp(preferred.x, bounds.minX, bounds.maxX)]);
  const ys = new Set([bounds.minY, bounds.maxY, clamp(preferred.y, bounds.minY, bounds.maxY)]);
  for (const point of others) {
    for (const sign of [-1, 1]) {
      xs.add(clamp(point.x + sign * distance, bounds.minX, bounds.maxX));
      ys.add(clamp(point.y + sign * distance, bounds.minY, bounds.maxY));
    }
  }
  let best = null, bestDistance = Infinity;
  for (const x of xs) for (const y of ys) {
    if (others.some(point => Math.abs(point.x - x) < distance - 1e-7 && Math.abs(point.y - y) < distance - 1e-7)) continue;
    const score = (x - preferred.x) ** 2 + (y - preferred.y) ** 2;
    if (score < bestDistance) { best = { x, y };bestDistance = score; }
  }
  return best;
}

export function resolveControlPositions(layout, viewport, { handedness = 'standard', bottom = 18 } = {}) {
  const geometry = controlGeometry(viewport), { width, height, size, minX, maxX, minY, maxY } = geometry;
  const step = size + 10, y = clamp(maxY - Math.max(0, bottom - Math.max(12, Number(viewport.safe?.bottom) || 0)), Math.min(maxY, minY + step), maxY);
  const steering = handedness === 'left-handed' ? maxX - step : minX;
  const actions = handedness === 'left-handed' ? minX : maxX - step;
  const defaults = {
    left: { x: steering, y }, right: { x: steering + step, y },
    drift: { x: actions, y: y - step }, nitro: { x: actions + step, y: y - step },
    brake: { x: actions, y }, throttle: { x: actions + step, y },
    useItem: { x: steering + step / 2, y: y - step },
  };
  const positions = {};
  for (const action of CONTROL_ACTIONS) {
    const point = layout?.[action];
    positions[action] = {
      x: clamp(point ? point.x * width : defaults[action].x, minX, maxX),
      y: clamp(point ? point.y * height : defaults[action].y, minY, maxY),
    };
  }
  geometry.itemSize = size;
  if (layout) {
    for (const itemSize of [...new Set([size, Math.min(size, 44), Math.min(size, 24)])]) {
      const point = availableItemPosition(positions.useItem, positions, size, itemSize, geometry);
      if (point) { positions.useItem = point;geometry.itemSize = itemSize;break; }
    }
  }
  return { positions, geometry };
}

export function normalizeControlPositions(positions, { width, height }) {
  return Object.fromEntries(CONTROL_ACTIONS.map(action => [action, {
    x: clamp(positions[action].x / Math.max(1, width), 0, 1),
    y: clamp(positions[action].y / Math.max(1, height), 0, 1),
  }]));
}

export function overlappingControls(positions, size, itemSize = size) {
  for (let i = 0; i < CONTROL_ACTIONS.length; i++) for (let j = i + 1; j < CONTROL_ACTIONS.length; j++) {
    const a = positions[CONTROL_ACTIONS[i]], b = positions[CONTROL_ACTIONS[j]];
    if (!a || !b) continue;
    const clearance = ((CONTROL_ACTIONS[i] === 'useItem' ? itemSize : size) + (CONTROL_ACTIONS[j] === 'useItem' ? itemSize : size)) / 2 + 3;
    if (Math.abs(a.x - b.x) < clearance - 1e-7 && Math.abs(a.y - b.y) < clearance - 1e-7) return true;
  }
  return false;
}

export class ControlLayoutEditor {
  constructor(root, { storage, onStatus = () => {}, onReturn = () => {} } = {}) {
    this.root = root;this.storage = storage;this.onStatus = onStatus;this.onReturn = onReturn;
    this.layouts = readControlLayouts(storage);this.settings = {};this.isOpen = false;this.drag = null;
    this.buttons = [...root.querySelectorAll('.touch-controls [data-touch]')];
    const doc = root.ownerDocument;this.window = doc.defaultView;
    this.probe = doc.createElement('div');this.probe.className = 'control-safe-probe';root.append(this.probe);
    const editor = doc.createElement('section');editor.className = 'control-layout-editor';editor.hidden = true;
    editor.setAttribute('role', 'dialog');editor.setAttribute('aria-modal', 'true');editor.setAttribute('aria-labelledby', 'control-editor-title');
    editor.innerHTML = `
      <div class="control-editor-bar">
        <div><h2 id="control-editor-title">把按键放到顺手的位置</h2><p class="control-editor-description">拖动七个按键 · 横竖屏分别保存 · 方向键可微调</p></div>
        <div class="control-editor-actions"><button type="button" class="control-editor-reset">恢复预设</button><button type="button" class="control-editor-cancel">取消</button><button type="button" class="control-editor-save">保存布局 ✓</button></div>
      </div>
      <p class="control-editor-status" role="status">拖动按键，避开车头和比赛信息。</p>
      <div class="control-editor-road" aria-hidden="true"><span>你的赛道视野</span><small>把常用按键留在拇指附近</small></div>
      ${CONTROL_ACTIONS.map(action => `<button type="button" class="control-editor-button control-editor-${action}" data-layout-action="${action}" aria-label="调整${labels[action]}位置，拖动或用方向键微调">${labels[action]}</button>`).join('')}`;
    root.append(editor);this.editor = editor;
    this.previews = [...editor.querySelectorAll('[data-layout-action]')];
    this.saveButton = editor.querySelector('.control-editor-save');
    editor.querySelector('.control-editor-cancel').addEventListener('click', () => this.cancel());
    editor.querySelector('.control-editor-reset').addEventListener('click', () => {
      this.draft[this.orientation()] = null;this.endDrag();this.renderEditor();
    });
    this.saveButton.addEventListener('click', () => this.save());
    for (const button of this.previews) {
      button.addEventListener('pointerdown', event => this.beginDrag(event, button), { passive: false });
      button.addEventListener('pointermove', event => this.moveDrag(event), { passive: false });
      button.addEventListener('pointerup', () => this.endDrag());
      button.addEventListener('pointercancel', () => this.endDrag());
      button.addEventListener('lostpointercapture', event => { if (this.drag?.id === event.pointerId) this.drag = null; });
      button.addEventListener('contextmenu', event => event.preventDefault());
      button.addEventListener('keydown', event => this.nudge(event, button));
    }
    editor.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault();this.cancel(); }
      if (event.key === 'Tab') {
        const targets = [...editor.querySelectorAll('button')].filter(button => !button.disabled), active = doc.activeElement;
        if (event.shiftKey && active === targets[0]) { event.preventDefault();targets.at(-1).focus(); }
        else if (!event.shiftKey && active === targets.at(-1)) { event.preventDefault();targets[0].focus(); }
      }
    });
    this.resize = () => { this.endDrag();this.apply(this.settings);if (this.isOpen) this.renderEditor(); };
    this.window?.addEventListener('resize', this.resize);this.window?.addEventListener('orientationchange', this.resize);
    this.window?.visualViewport?.addEventListener('resize', this.resize);
    this.window?.addEventListener('pointerup', () => this.endDrag());
    this.window?.addEventListener('pointercancel', () => this.endDrag());
  }

  viewport() {
    const rect = this.root.getBoundingClientRect(), css = this.window.getComputedStyle(this.probe);
    return { width: rect.width, height: rect.height, size: this.settings.buttonSize,
      safe: { left: parseFloat(css.paddingLeft), right: parseFloat(css.paddingRight), top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom) } };
  }
  orientation() { const viewport = this.viewport();return layoutOrientation(viewport.width, viewport.height); }
  resolve(layout) { return resolveControlPositions(layout, this.viewport(), { handedness: this.settings.controlLayout, bottom: this.settings.controlBottom }); }

  apply(settings) {
    this.settings = settings;
    const layout = this.layouts[this.orientation()];this.root.dataset.customControls = String(Boolean(layout));
    this.adaptedDefaults = false;
    if (!layout) return;
    const { positions, geometry } = this.resolve(layout);
    // A layout saved on a much larger display must never leave two actions on top of each other.
    if (overlappingControls(positions, geometry.size, geometry.itemSize)) { this.adaptedDefaults = true;this.root.dataset.customControls = 'false';return; }
    this.root.style.setProperty('--custom-control-size', `${geometry.size}px`);
    for (const button of this.buttons) {
      const action = button.dataset.touch, point = positions[action];
      if (!point) continue;
      button.style.setProperty('--custom-control-size', `${action === 'useItem' ? geometry.itemSize : geometry.size}px`);
      button.style.left = `${point.x}px`;button.style.top = `${point.y}px`;
    }
  }

  hasCustom() { return Boolean(this.layouts.landscape || this.layouts.portrait); }

  reset() {
    this.layouts = emptyLayouts();
    const saved = saveControlLayouts(this.storage, this.layouts);this.apply(this.settings);
    this.onStatus(saved ? '已恢复预设按键位置。' : '已恢复预设，但浏览器未能保存；刷新后可能还原。');return saved;
  }

  open() {
    this.draft = validateControlLayouts(this.layouts);this.isOpen = true;this.editor.hidden = false;
    this.root.classList.add('editing-controls');this.renderEditor();this.editor.querySelector('.control-editor-cancel').focus();
  }

  finish() {
    this.endDrag();this.isOpen = false;this.editor.hidden = true;this.root.classList.remove('editing-controls');this.onReturn();
  }
  cancel() { if (this.isOpen) this.finish(); }

  renderEditor() {
    const orientation = this.orientation(), { positions, geometry } = this.resolve(this.draft[orientation]);
    this.editor.style.setProperty('--editor-control-size', `${geometry.size}px`);
    for (const button of this.previews) {
      const action = button.dataset.layoutAction, point = positions[action];
      button.style.setProperty('--editor-control-size', `${action === 'useItem' ? geometry.itemSize : geometry.size}px`);
      button.style.left = `${point.x}px`;button.style.top = `${point.y}px`;
    }
    this.saveButton.disabled = overlappingControls(positions, geometry.size, geometry.itemSize);
    this.editor.querySelector('.control-editor-status').textContent = this.saveButton.disabled ? '有按键重叠，请稍微分开后再保存。' : `${orientation === 'landscape' ? '横屏' : '竖屏'}布局 · 拖动按键，避开车头和比赛信息。`;
    this.editor.querySelector('.control-editor-description').textContent = `拖动七个按键 · 横竖屏分别保存 · ${this.settings.controlLayout === 'left-handed' ? '右手转向预设' : '左手转向预设'}`;
  }

  updatePosition(action, x, y) {
    const viewport = this.viewport(), current = this.resolve(this.draft[this.orientation()]), g = current.geometry;
    current.positions[action] = { x: clamp(x, g.minX, g.maxX), y: clamp(y, g.minY, g.maxY) };
    this.draft[this.orientation()] = normalizeControlPositions(current.positions, viewport);this.renderEditor();
  }

  beginDrag(event, button) {
    if (this.drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();button.focus();
    const point = this.resolve(this.draft[this.orientation()]).positions[button.dataset.layoutAction], rect = this.root.getBoundingClientRect();
    this.drag = { id: event.pointerId, button, action: button.dataset.layoutAction, x: event.clientX - rect.left - point.x, y: event.clientY - rect.top - point.y };
    try { button.setPointerCapture(event.pointerId); } catch { /* Window pointer-up still ends the gesture. */ }
    button.classList.add('dragging');
  }
  moveDrag(event) {
    if (this.drag?.id !== event.pointerId) return;
    event.preventDefault();const rect = this.root.getBoundingClientRect(), drag = this.drag;
    this.updatePosition(drag.action, event.clientX - rect.left - drag.x, event.clientY - rect.top - drag.y);
  }
  endDrag() {
    const drag = this.drag;this.drag = null;if (!drag) return;
    drag.button.classList.remove('dragging');
    try { if (drag.button.hasPointerCapture?.(drag.id)) drag.button.releasePointerCapture(drag.id); } catch {}
  }
  nudge(event, button) {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }, delta = directions[event.key];
    if (!delta) return;event.preventDefault();event.stopPropagation();
    const action = button.dataset.layoutAction, point = this.resolve(this.draft[this.orientation()]).positions[action], step = event.shiftKey ? 8 : 2;
    this.updatePosition(action, point.x + delta[0] * step, point.y + delta[1] * step);
  }
  save() {
    if (!this.isOpen || this.saveButton.disabled) return;
    // Save the visible clamped positions, not stale coordinates outside this screen.
    const orientation = this.orientation(), resolved = this.resolve(this.draft[orientation]);
    if (this.draft[orientation]) this.draft[orientation] = normalizeControlPositions(resolved.positions, this.viewport());
    this.layouts = validateControlLayouts(this.draft);const saved = saveControlLayouts(this.storage, this.layouts);
    this.apply(this.settings);this.finish();
    this.onStatus(saved ? '按键布局已保存在本机，刷新后仍会保留。' : '布局已应用，但浏览器未能保存；刷新后会还原。');
  }
}
