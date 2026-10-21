const nativeSelector = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.room-code,[data-allow-selection]';
const playSelector = '#game,.touch-controls,.race-hud,[data-layout-action]';

export function browserGesturePolicy(target) {
  const element = target?.nodeType === 3 ? target.parentElement : target;
  if (!element?.closest || element.closest(nativeSelector)) return { selection: false, movement: false };
  return { selection: Boolean(element.closest('#app,#game')), movement: Boolean(element.closest(playSelector)) };
}

/** Stop browser gestures on game surfaces while preserving forms and dialog scrolling. */
export function installBrowserGuards(documentTarget = globalThis.document) {
  const listeners = [];
  const listen = (type, handler, options) => {
    documentTarget.addEventListener(type, handler, options);
    listeners.push(() => documentTarget.removeEventListener(type, handler, options));
  };
  for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
    listen(type, event => { if (browserGesturePolicy(event.target).selection) event.preventDefault(); }, { capture: true });
  }
  listen('touchstart', event => {
    // Only pointer-driven controls suppress compatibility clicks; HUD buttons
    // such as automatic throttle still need their ordinary click event.
    if (browserGesturePolicy(event.target).movement && event.target?.closest?.('#game,[data-touch],[data-layout-action]') && event.cancelable) event.preventDefault();
  }, { passive: false });
  // Safari gesture events and legacy touch scrolling supplement CSS touch-action.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'touchmove', 'dblclick']) {
    listen(type, event => { if (browserGesturePolicy(event.target).movement && event.cancelable) event.preventDefault(); }, { passive: false });
  }
  return () => { for (const remove of listeners) remove(); };
}
