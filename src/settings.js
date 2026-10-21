import { ControlLayoutEditor } from './control-layout.js';

export const SETTINGS_STORAGE_KEY = 'sunny-settings-v1';
export const DEFAULT_SETTINGS = Object.freeze({
  controlLayout: 'standard',
  steeringSensitivity: 1,
  buttonSize: 64,
  buttonOpacity: .78,
  controlBottom: 18,
  autoThrottle: false,
  graphics: 'auto',
  soundVolume: .7,
});

const ranges = {
  steeringSensitivity: [.35, 1], buttonSize: [56, 84],
  buttonOpacity: [.35, 1], controlBottom: [8, 48], soundVolume: [0, 1],
};
const integerKeys = new Set(['buttonSize', 'controlBottom']);
const enums = { controlLayout: ['standard', 'left-handed'], graphics: ['auto', 'smooth', 'sharp'] };
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** Only known keys and typed values survive storage or programmatic input. */
export function validateSettings(value, defaults = DEFAULT_SETTINGS) {
  const source = record(value), preferred = record(defaults), result = {};
  for (const [key, base] of Object.entries(DEFAULT_SETTINGS)) {
    const normalize = candidate => {
      if (key === 'autoThrottle') return typeof candidate === 'boolean' ? candidate : undefined;
      if (enums[key]) return enums[key].includes(candidate) ? candidate : undefined;
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return undefined;
      const [min, max] = ranges[key], clamped = Math.max(min, Math.min(max, candidate));
      return integerKeys.has(key) ? Math.round(clamped) : Math.round(clamped * 100) / 100;
    };
    result[key] = normalize(source[key]) ?? normalize(preferred[key]) ?? base;
  }
  return result;
}

export function readSettings(storage, defaults = DEFAULT_SETTINGS) {
  try { return validateSettings(JSON.parse(storage?.getItem(SETTINGS_STORAGE_KEY) || 'null'), defaults); }
  catch { return validateSettings({}, defaults); }
}

export function saveSettings(storage, values, defaults = DEFAULT_SETTINGS) {
  try { storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(validateSettings(values, defaults)));return Boolean(storage); }
  catch { return false; }
}

function browserStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
function touchDefault() {
  return Boolean(globalThis.navigator?.maxTouchPoints > 0 || globalThis.window?.matchMedia?.('(any-pointer: coarse)').matches);
}

export class GameSettings {
  constructor(root, { defaults = {}, onOpen, onClose, onChange, storage = browserStorage() } = {}) {
    this.root = root;this.onOpen = onOpen;this.onClose = onClose;this.onChange = onChange;this.storage = storage;
    this.defaults = validateSettings(defaults, { ...DEFAULT_SETTINGS, autoThrottle: touchDefault() });
    this.values = Object.freeze(readSettings(storage, this.defaults));this.isOpen = false;
    const overlay = root.ownerDocument.createElement('section');
    overlay.className = 'overlay settings-overlay';overlay.hidden = true;
    overlay.innerHTML = `
      <div class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button class="close-button settings-close" type="button" aria-label="关闭游戏设置">×</button>
        <span class="dialog-eyebrow">MAKE IT YOUR RIDE</span>
        <h2 id="settings-title">调成顺手的样子。</h2>
        <p class="settings-intro">按键、驾驶和画面，按你的习惯来。调整会自动保存在本机。</p>
        <div class="settings-grid">
          <section class="settings-section" aria-labelledby="settings-controls-title">
            <h3 id="settings-controls-title">驾驶与按键</h3>
            <label class="settings-field"><span>触控布局</span><select data-setting="controlLayout" aria-label="触控布局"><option value="standard">标准 · 左手转向</option><option value="left-handed">左手动作 · 右手转向</option></select><small>切换预设会恢复按键位置；大小和灵敏度保留。</small></label>
            <button type="button" class="settings-custom-layout"><span>自定义按键位置</span><span aria-hidden="true">拖动排列 ↗</span></button>
            <p class="settings-layout-summary">横屏与竖屏的按键位置分别保存。</p>
            <label class="settings-field settings-toggle"><span>自动油门<small>开启后专心转向，仍可按住刹车减速。</small></span><input data-setting="autoThrottle" type="checkbox" aria-label="设置自动油门" /></label>
            ${this.slider('steeringSensitivity', '转向灵敏度', .35, 1, .05, '降低灵敏度，转弯更柔和。')}
            ${this.slider('buttonSize', '按键大小', 56, 84, 1)}
            ${this.slider('buttonOpacity', '按键不透明度', .35, 1, .01)}
            ${this.slider('controlBottom', '按键离底部距离', 8, 48, 1)}
          </section>
          <section class="settings-section" aria-labelledby="settings-display-title">
            <h3 id="settings-display-title">画面与声音</h3>
            <label class="settings-field"><span>画面质量</span><select data-setting="graphics" aria-label="画面质量"><option value="auto">自动 · 推荐</option><option value="smooth">流畅优先</option><option value="sharp">清晰优先</option></select></label>
            <p class="settings-note">手机发热或画面卡顿时，可以切换到流畅优先。</p>
            ${this.slider('soundVolume', '总音量', 0, 1, .05)}
            <div class="settings-tip"><strong>双手都舒服，弯道才顺手。</strong><p>左侧方向键可以按住或滑动切换；漂移转弯时按住，松开后小喷。⚡ 氮气可以与转向同时按住。</p></div>
          </section>
        </div>
        <p class="settings-save-status" role="status"></p>
        <div class="settings-footer"><button type="button" class="settings-reset">恢复默认设置</button><button type="button" class="primary-button settings-done">完成，继续出发 <span aria-hidden="true">→</span></button></div>
      </div>`;
    root.append(overlay);this.overlay = overlay;
    this.closeButton = overlay.querySelector('.settings-close');
    this.controls = [...overlay.querySelectorAll('[data-setting]')];
    this.openButton = root.querySelector('.settings-button');
    this.layoutEditor = new ControlLayoutEditor(root, { storage,
      onStatus: message => { this.overlay.querySelector('.settings-save-status').textContent = message;this.render(); },
      onReturn: () => { if (this.isOpen) { this.overlay.hidden = false;this.overlay.querySelector('.settings-custom-layout').focus(); } },
    });
    overlay.querySelector('.settings-custom-layout').addEventListener('click', () => { this.overlay.hidden = true;this.layoutEditor.open(); });
    this.openButton?.addEventListener('click', () => this.open());
    this.closeButton.addEventListener('click', () => this.close());
    overlay.querySelector('.settings-done').addEventListener('click', () => this.close());
    overlay.querySelector('.settings-reset').addEventListener('click', () => { this.layoutEditor.reset();this.setValues(this.defaults); });
    for (const control of this.controls) {
      control.addEventListener(control.type === 'range' ? 'input' : 'change', () => {
        const key = control.dataset.setting;
        const value = control.type === 'checkbox' ? control.checked : control.type === 'range' ? Number(control.value) : control.value;
        this.setValues({ [key]: value });
      });
    }
    overlay.addEventListener('click', event => { if (event.target === overlay) this.close(); });
    overlay.addEventListener('keydown', event => {
      // Keep arrow keys and shortcuts in this dialog out of the driving input.
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault();this.close();return; }
      if (event.key !== 'Tab') return;
      const targets = [...overlay.querySelectorAll('button,input,select')].filter(element => !element.disabled);
      const first = targets[0], last = targets.at(-1), active = root.ownerDocument.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault();last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault();first.focus(); }
    });
    this.apply();this.render();
  }

  slider(key, label, min, max, step, description = '') {
    return `<label class="settings-field"><span>${label}<output data-value="${key}" aria-hidden="true"></output></span><input data-setting="${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" />${description ? `<small>${description}</small>` : ''}</label>`;
  }

  setValues(patch, { notify = true, persist = true } = {}) {
    const previousLayout = this.values.controlLayout;
    this.values = Object.freeze(validateSettings({ ...this.values, ...record(patch) }, this.defaults));
    if (previousLayout !== this.values.controlLayout) this.layoutEditor.reset();
    if (persist && !saveSettings(this.storage, this.values, this.defaults)) this.overlay.querySelector('.settings-save-status').textContent = '设置已应用，但浏览器未能保存；刷新后可能还原。';
    this.apply();this.render();
    if (notify) this.onChange?.({ ...this.values });
    return this.values;
  }

  apply() {
    this.root.dataset.controlLayout = this.values.controlLayout;
    this.root.style.setProperty('--control-size', `${this.values.buttonSize}px`);
    this.root.style.setProperty('--control-opacity', String(this.values.buttonOpacity));
    this.root.style.setProperty('--control-bottom', `${this.values.controlBottom}px`);
    this.layoutEditor.apply(this.values);
  }

  render() {
    for (const control of this.controls) {
      const value = this.values[control.dataset.setting];
      if (control.type === 'checkbox') control.checked = value;
      else control.value = String(value);
    }
    for (const output of this.overlay.querySelectorAll('[data-value]')) {
      const key = output.dataset.value, value = this.values[key];
      output.textContent = key === 'buttonSize' || key === 'controlBottom' ? `${value} px` : `${Math.round(value * 100)}%`;
    }
    const side = this.values.controlLayout === 'left-handed' ? '右侧' : '左侧';
    this.overlay.querySelector('.settings-tip p').textContent = `${side}方向键可以按住或滑动切换；漂移转弯时按住，松开后小喷。⚡ 氮气可以与转向同时按住。`;
    const customized = this.layoutEditor.hasCustom();
    this.overlay.querySelector('.settings-layout-summary').textContent = this.layoutEditor.adaptedDefaults ? '当前屏幕较小，已临时使用预设避免按键重叠；原布局仍保留，可重新调整。' : customized ? '已保存自定义位置 · 横竖屏分别记录；切换预设可恢复。' : '当前使用预设位置 · 横屏与竖屏可以分别自定义。';
    this.overlay.querySelector('[data-setting="controlBottom"]').disabled = this.root.dataset.customControls === 'true';
  }

  open() {
    if (this.isOpen) return;
    this.onOpen?.();this.isOpen = true;this.overlay.hidden = false;
    this.apply();this.render();
    this.previousFocus = this.root.ownerDocument.activeElement;this.closeButton.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;this.layoutEditor.cancel();this.overlay.hidden = true;this.onClose?.();
    const target = this.openButton || this.previousFocus;
    if (target?.isConnected) target.focus();
  }
}
