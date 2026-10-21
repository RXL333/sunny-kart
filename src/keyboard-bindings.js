export const KEY_BINDINGS_STORAGE_KEY = 'sunny-keyboard-v1';

export const KEYBOARD_ACTIONS = Object.freeze([
  { id: 'throttle', label: '加速' },
  { id: 'brake', label: '刹车' },
  { id: 'left', label: '向左转向' },
  { id: 'right', label: '向右转向' },
  { id: 'drift', label: '漂移' },
  { id: 'nitro', label: '氮气' },
  { id: 'autoThrottle', label: '自动油门' },
  { id: 'pause', label: '暂停 / 继续' },
  { id: 'restart', label: '重新比赛' },
].map(action => Object.freeze(action)));

export const DEFAULT_KEY_BINDINGS = Object.freeze(Object.fromEntries(Object.entries({
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  drift: ['ShiftLeft', 'ShiftRight'],
  nitro: ['Space', 'KeyN'],
  autoThrottle: ['KeyQ'],
  pause: ['Escape'],
  restart: ['KeyR'],
}).map(([action, codes]) => [action, Object.freeze(codes)])));

const actionLabels = new Map(KEYBOARD_ACTIONS.map(action => [action.id, action.label]));
const specialLabels = Object.freeze({
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: '空格', ShiftLeft: '左Shift', ShiftRight: '右Shift', Enter: '回车', Escape: 'Esc',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  NumpadAdd: '小键盘+', NumpadSubtract: '小键盘−', NumpadMultiply: '小键盘×',
  NumpadDivide: '小键盘÷', NumpadDecimal: '小键盘.', NumpadEnter: '小键盘回车',
});

/** Use physical KeyboardEvent.code values so shifted characters never change a binding. */
export function isBindableCode(code) {
  return typeof code === 'string' && (
    /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9])$/.test(code) || Object.hasOwn(specialLabels, code)
  );
}

export function keyLabel(code) {
  if (!isBindableCode(code)) return '未设置';
  if (Object.hasOwn(specialLabels, code)) return specialLabels[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return `小键盘${code.slice(6)}`;
}

function copyBindings(bindings = DEFAULT_KEY_BINDINGS) {
  return Object.fromEntries(KEYBOARD_ACTIONS.map(({ id }) => [id, [...bindings[id]]]));
}

/** A corrupt or incomplete record cannot leave any driving action unbound. */
export function validateKeyBindings(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return copyBindings();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return copyBindings();
    if (Object.keys(value).length !== KEYBOARD_ACTIONS.length) return copyBindings();
    const used = new Set();
    for (const { id } of KEYBOARD_ACTIONS) {
      if (!Object.hasOwn(value, id)) return copyBindings();
      const codes = value[id];
      if (!Array.isArray(codes) || codes.length < 1 || codes.length > 2) return copyBindings();
      for (const code of codes) {
        if (!isBindableCode(code) || used.has(code)) return copyBindings();
        used.add(code);
      }
    }
    return copyBindings(value);
  } catch {
    return copyBindings();
  }
}

export function readKeyBindings(storage) {
  try { return validateKeyBindings(JSON.parse(storage?.getItem(KEY_BINDINGS_STORAGE_KEY) || 'null')); }
  catch { return copyBindings(); }
}

export function saveKeyBindings(storage, bindings) {
  try {
    if (typeof storage?.setItem !== 'function') return false;
    storage.setItem(KEY_BINDINGS_STORAGE_KEY, JSON.stringify(validateKeyBindings(bindings)));
    return true;
  } catch { return false; }
}

/** Reject collisions instead of silently removing another action's control. */
export function assignKeyBinding(bindings, action, slot, code) {
  const next = validateKeyBindings(bindings);
  const reject = error => ({ bindings: next, error });
  if (!actionLabels.has(action) || !Number.isInteger(slot) || slot < 0 || slot > 1)
    return reject('没有找到这个按键位置，请重新选择。');
  if (code === null) {
    if (slot === 0) return reject('每个功能至少保留一个主按键。');
    next[action] = next[action].slice(0, 1);
    return { bindings: next, error: null };
  }
  if (!isBindableCode(code)) return reject('这个按键留给浏览器使用，请选择字母、数字、方向键、空格等。');
  for (const { id } of KEYBOARD_ACTIONS) {
    const existingSlot = next[id].indexOf(code);
    if (existingSlot < 0 || (id === action && existingSlot === slot)) continue;
    return reject(`${keyLabel(code)} 已用于「${actionLabels.get(id)}」，请先更改或清除该位置的按键。`);
  }
  next[action][slot] = code;
  return { bindings: next, error: null };
}

export function isActionPressed(keys, bindings, action) {
  const codes = bindings?.[action];
  return Boolean(keys && typeof keys.has === 'function' && Array.isArray(codes) && codes.some(code => keys.has(code)));
}

export function actionForKey(bindings, code) {
  return KEYBOARD_ACTIONS.find(({ id }) => Array.isArray(bindings?.[id]) && bindings[id].includes(code))?.id;
}
