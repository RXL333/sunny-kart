import { ControlLayoutEditor } from './control-layout.js';
import { KEYBOARD_ACTIONS, DEFAULT_KEY_BINDINGS, readKeyBindings, saveKeyBindings, assignKeyBinding, keyLabel, isBindableCode, validateKeyBindings } from './keyboard-bindings.js';

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
const controlModes = ['keyboard', 'touch'];
const freezeBindings = bindings => Object.freeze(Object.fromEntries(Object.entries(bindings).map(([action, codes]) => [action, Object.freeze([...codes])])));

export class GameSettings {
  constructor(root, { defaults = {}, onOpen, onClose, onChange, onBindingsChange, storage = browserStorage() } = {}) {
    this.root = root;this.onOpen = onOpen;this.onClose = onClose;this.onChange = onChange;this.onBindingsChange = onBindingsChange;this.storage = storage;
    this.defaults = validateSettings(defaults, { ...DEFAULT_SETTINGS, autoThrottle: touchDefault() });
    this.values = Object.freeze(readSettings(storage, this.defaults));this.isOpen = false;
    this.bindings = freezeBindings(readKeyBindings(storage));this.recording = null;
    // MobileExperience sets the real input mode on the game root before settings are created.
    // Standalone components without a mode retain their existing touch settings as a safe fallback.
    this.inputMode = controlModes.includes(root.dataset.inputMode) ? root.dataset.inputMode : 'touch';
    this.activeControlMode = this.inputMode;
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
            <div class="settings-control-tabs" role="tablist" aria-label="按键设置设备">
              <button type="button" role="tab" id="settings-keyboard-tab" data-control-mode="keyboard" aria-controls="settings-keyboard-panel">电脑键盘</button>
              <button type="button" role="tab" id="settings-touch-tab" data-control-mode="touch" aria-controls="settings-touch-panel">手机触控</button>
            </div>
            <div class="settings-keyboard-panel" id="settings-keyboard-panel" role="tabpanel" aria-labelledby="settings-keyboard-tab" hidden>
              <p class="settings-mode-note">点选按键，再按下你习惯的键；每项可设置主键和副键。Esc 取消录制。</p>
              <p class="settings-key-record-status" role="note" aria-live="off">主键始终保留，副键可以按需添加或清除。</p>
              <div class="settings-keyboard-head" aria-hidden="true"><span>功能</span><span>主键</span><span>副键</span><span></span></div>
              <div class="settings-keyboard-list">${KEYBOARD_ACTIONS.map(({ id, label }) => `<div class="settings-keyboard-row" data-binding-row="${id}"><strong>${label}</strong><button type="button" class="settings-key-binding" data-binding-action="${id}" data-binding-slot="0" aria-label="修改${label}主键"></button><button type="button" class="settings-key-binding" data-binding-action="${id}" data-binding-slot="1" aria-label="修改${label}副键"></button><button type="button" class="settings-key-clear" data-clear-binding="${id}" aria-label="清除${label}副键" title="清除副键">×</button></div>`).join('')}</div>
              <p class="settings-keyboard-note">字母键按键盘位置识别；不录制 Tab、浏览器快捷键或系统功能键。按键提示会随设置一起更新。</p>
            </div>
            <div class="settings-touch-panel" id="settings-touch-panel" role="tabpanel" aria-labelledby="settings-touch-tab">
              <label class="settings-field"><span>触控布局</span><select data-setting="controlLayout" aria-label="触控布局"><option value="standard">标准 · 左手转向</option><option value="left-handed">左手动作 · 右手转向</option></select><small>切换预设会恢复按键位置；大小和灵敏度保留。</small></label>
              <button type="button" class="settings-custom-layout"><span>自定义按键位置</span><span aria-hidden="true">拖动排列 ↗</span></button>
              <p class="settings-layout-summary">横屏与竖屏的按键位置分别保存。</p>
              ${this.slider('buttonSize', '按键大小', 56, 84, 1)}
              ${this.slider('buttonOpacity', '按键不透明度', .35, 1, .01)}
              ${this.slider('controlBottom', '按键离底部距离', 8, 48, 1)}
            </div>
            <label class="settings-field settings-toggle"><span>自动油门<small>开启后专心转向，仍可按住刹车减速。</small></span><input data-setting="autoThrottle" type="checkbox" aria-label="设置自动油门" /></label>
            ${this.slider('steeringSensitivity', '转向灵敏度', .35, 1, .05, '降低灵敏度，转弯更柔和。')}
          </section>
          <section class="settings-section" aria-labelledby="settings-display-title">
            <h3 id="settings-display-title">画面与声音</h3>
            <label class="settings-field"><span>画面质量</span><select data-setting="graphics" aria-label="画面质量"><option value="auto">自动 · 推荐</option><option value="smooth">流畅优先</option><option value="sharp">清晰优先</option></select></label>
            <p class="settings-note">画面卡顿或设备发热时，可以切换到流畅优先。</p>
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
    overlay.querySelector('.settings-custom-layout').addEventListener('click', () => { this.cancelRecording();this.overlay.hidden = true;this.layoutEditor.open(); });
    this.openButton?.addEventListener('click', () => this.open());
    this.closeButton.addEventListener('click', () => this.close());
    overlay.querySelector('.settings-done').addEventListener('click', () => this.close());
    overlay.querySelector('.settings-reset').addEventListener('click', () => {
      this.cancelRecording();
      if (this.activeControlMode === 'keyboard') this.setBindings(DEFAULT_KEY_BINDINGS, '电脑键位已恢复默认，手机按键位置已保留。');
      else { this.layoutEditor.reset();this.setValues(this.defaults); }
    });
    for (const tab of overlay.querySelectorAll('[data-control-mode]')) tab.addEventListener('click', () => this.selectControlMode(tab.dataset.controlMode));
    for (const button of overlay.querySelectorAll('[data-binding-action]')) button.addEventListener('click', () => this.beginRecording(button.dataset.bindingAction, Number(button.dataset.bindingSlot)));
    for (const button of overlay.querySelectorAll('[data-clear-binding]')) button.addEventListener('click', () => {
      this.cancelRecording();const action = button.dataset.clearBinding;
      const result = assignKeyBinding(this.bindings, action, 1, null);
      if (result.error) this.status(result.error);else this.setBindings(result.bindings, '副键已清除，主键仍可正常使用。');
    });
    for (const control of this.controls) {
      control.addEventListener(control.type === 'range' ? 'input' : 'change', () => {
        const key = control.dataset.setting;
        const value = control.type === 'checkbox' ? control.checked : control.type === 'range' ? Number(control.value) : control.value;
        this.setValues({ [key]: value });
      });
    }
    overlay.addEventListener('click', event => { if (event.target === overlay) this.close(); });
    overlay.addEventListener('pointerdown', event => {
      if (this.recording && !event.target.closest?.('[data-binding-action]')) this.cancelRecording('已取消改键，原按键保持不变。', false);
    });
    overlay.addEventListener('keydown', event => {
      // Keep arrow keys and shortcuts in this dialog out of the driving input.
      event.stopPropagation();
      if (this.recording) {
        if (event.key === 'Escape' || event.code === 'Escape') { event.preventDefault();this.cancelRecording('已取消改键，原按键保持不变。');return; }
        if (event.key === 'Tab' || event.code === 'Tab') this.cancelRecording('已取消改键，原按键保持不变。', false);
        else { this.captureBinding(event);return; }
      }
      if (event.key === 'Escape') { event.preventDefault();this.close();return; }
      if (event.target.matches?.('[data-control-mode]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();const next = event.key === 'Home' ? 'keyboard' : event.key === 'End' ? 'touch' : this.activeControlMode === 'keyboard' ? 'touch' : 'keyboard';
        this.selectControlMode(next);overlay.querySelector(`[data-control-mode="${next}"]`).focus();return;
      }
      if (event.key !== 'Tab') return;
      const targets = [...overlay.querySelectorAll('button,input,select')].filter(element => !element.disabled && !element.closest('[hidden]') && element.getAttribute('tabindex') !== '-1');
      const first = targets[0], last = targets.at(-1), active = root.ownerDocument.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault();last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault();first.focus(); }
    }, true);
    root.ownerDocument.defaultView?.addEventListener('blur', () => this.cancelRecording('窗口已切换，改键已取消。', false));
    root.ownerDocument.addEventListener('visibilitychange', () => { if (root.ownerDocument.hidden) this.cancelRecording('页面已切换，改键已取消。', false); });
    this.apply();this.render();
  }

  status(message) {
    this.overlay.querySelector('.settings-save-status').textContent = message;
    this.overlay.querySelector('.settings-key-record-status').textContent = message;
  }

  setInputMode(mode) {
    if (!controlModes.includes(mode)) return;
    this.inputMode = mode;
    // A player can inspect either set of controls while the dialog is open.
    if (!this.isOpen) this.selectControlMode(mode);
  }

  selectControlMode(mode) {
    if (!controlModes.includes(mode)) return;
    this.cancelRecording();this.activeControlMode = mode;this.renderControlMode();
  }

  renderControlMode() {
    const keyboard = this.activeControlMode === 'keyboard';
    this.overlay.dataset.activeControlMode = this.activeControlMode;
    this.overlay.querySelector('.settings-keyboard-panel').hidden = !keyboard;
    this.overlay.querySelector('.settings-touch-panel').hidden = keyboard;
    for (const tab of this.overlay.querySelectorAll('[data-control-mode]')) {
      const active = tab.dataset.controlMode === this.activeControlMode;
      tab.setAttribute('aria-selected', String(active));tab.tabIndex = active ? 0 : -1;
    }
    this.overlay.querySelector('.settings-reset').textContent = keyboard ? '恢复默认键位' : '恢复默认设置';
    this.overlay.querySelector('.settings-tip strong').textContent = keyboard ? '按得顺手，过弯才从容。' : '双手都舒服，弯道才顺手。';
    const side = this.values.controlLayout === 'left-handed' ? '右侧' : '左侧';
    this.overlay.querySelector('.settings-tip p').textContent = keyboard
      ? `按住 ${this.bindings.drift.map(keyLabel).join(' / ')} 并转向来积攒漂移，松开后小喷；按住 ${this.bindings.nitro.map(keyLabel).join(' / ')} 释放氮气。道具赛按 ${this.bindings.useItem.map(keyLabel).join(' / ')} 使用道具。`
      : `${side}方向键可以按住或滑动切换；漂移转弯时按住，松开后小喷。⚡ 氮气可以与转向同时按住。道具赛点击道具按钮使用。`;
  }

  renderBindings() {
    for (const button of this.overlay.querySelectorAll('[data-binding-action]')) {
      const action = button.dataset.bindingAction, slot = Number(button.dataset.bindingSlot), code = this.bindings[action][slot];
      const recording = this.recording?.action === action && this.recording.slot === slot;
      button.textContent = recording ? '请按键…' : code ? keyLabel(code) : '添加';
      button.classList.toggle('recording', recording);button.setAttribute('aria-pressed', String(recording));
      const label = KEYBOARD_ACTIONS.find(item => item.id === action).label;
      button.setAttribute('aria-label', recording ? `正在录制${label}${slot ? '副键' : '主键'}，Esc 取消` : `修改${label}${slot ? '副键' : '主键'}，当前${code ? keyLabel(code) : '未设置'}`);
    }
    for (const button of this.overlay.querySelectorAll('[data-clear-binding]')) button.disabled = !this.bindings[button.dataset.clearBinding][1];
  }

  beginRecording(action, slot) {
    if (!this.isOpen || this.activeControlMode !== 'keyboard') return;
    this.recording = { action, slot };this.renderBindings();
    const label = KEYBOARD_ACTIONS.find(item => item.id === action)?.label;
    this.status(`正在设置${label}${slot ? '副键' : '主键'}：请按一个键，Esc 取消。`);
    this.overlay.querySelector(`[data-binding-action="${action}"][data-binding-slot="${slot}"]`).focus();
  }

  cancelRecording(message, focus = true) {
    if (!this.recording) return;
    const { action, slot } = this.recording;this.recording = null;this.renderBindings();
    if (message) this.status(message);
    if (focus && this.isOpen && !this.overlay.hidden) this.overlay.querySelector(`[data-binding-action="${action}"][data-binding-slot="${slot}"]`).focus();
  }

  captureBinding(event) {
    if (event.ctrlKey || event.altKey || event.metaKey) {
      this.status('请使用单个按键；浏览器与系统组合快捷键不参与改键。');return;
    }
    event.preventDefault();
    if (event.isComposing || event.keyCode === 229 || event.code === 'Process') { this.status('请先结束输入法输入，再按下要使用的键。');return; }
    if (event.repeat) return;
    if (!isBindableCode(event.code)) { this.status('这个按键留给浏览器或系统，请选择字母、方向键等常用按键。');return; }
    const { action, slot } = this.recording, result = assignKeyBinding(this.bindings, action, slot, event.code);
    if (result.error) { this.status(result.error);return; }
    this.cancelRecording();this.setBindings(result.bindings, `${KEYBOARD_ACTIONS.find(item => item.id === action).label}已改为 ${keyLabel(event.code)}，画面提示已同步。`);
  }

  setBindings(bindings, message = '电脑键位已更新，画面提示已同步。') {
    this.bindings = freezeBindings(validateKeyBindings(bindings));
    const saved = saveKeyBindings(this.storage, this.bindings);
    this.status(saved ? message : '键位已应用，但浏览器未能保存；刷新后可能还原。');
    this.renderBindings();this.renderControlMode();this.onBindingsChange?.(this.bindings);
    return this.bindings;
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
    this.renderBindings();this.renderControlMode();
    const customized = this.layoutEditor.hasCustom();
    this.overlay.querySelector('.settings-layout-summary').textContent = this.layoutEditor.adaptedDefaults ? '当前屏幕较小，已临时使用预设避免按键重叠；原布局仍保留，可重新调整。' : customized ? '已保存自定义位置 · 横竖屏分别记录；切换预设可恢复。' : '当前使用预设位置 · 横屏与竖屏可以分别自定义。';
    this.overlay.querySelector('[data-setting="controlBottom"]').disabled = this.root.dataset.customControls === 'true';
  }

  open() {
    if (this.isOpen) return;
    this.onOpen?.();this.isOpen = true;this.overlay.hidden = false;
    this.selectControlMode(this.inputMode);
    this.apply();this.render();
    this.previousFocus = this.root.ownerDocument.activeElement;this.closeButton.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.cancelRecording(undefined, false);this.isOpen = false;this.layoutEditor.cancel();this.overlay.hidden = true;this.onClose?.();
    const target = this.openButton || this.previousFocus;
    if (target?.isConnected) target.focus();
  }
}
