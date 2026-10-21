const actions = new Set(['left', 'right', 'throttle', 'brake', 'drift', 'nitro']);

/** Pointer ownership is separate from actions, so lifting one finger never
 * releases another finger that is holding the same control. */
export class TouchControls {
  constructor(buttons, {
    state = {}, onChange,
    windowTarget = globalThis.window,
    documentTarget = globalThis.document,
  } = {}) {
    this.buttons = [...buttons].filter(button => actions.has(button.dataset.touch));
    this.state = state;
    this.onChange = onChange;
    this.document = documentTarget;
    this.pointers = new Map();
    this.listeners = [];
    this.destroyed = false;

    for (const button of this.buttons) {
      this.listen(button, 'pointerdown', event => {
        if (this.destroyed || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        const previous = this.pointers.get(event.pointerId);
        if (previous) this.release(event.pointerId);
        const action = button.dataset.touch;
        this.pointers.set(event.pointerId, { owner: button, action, steering: action === 'left' || action === 'right' });
        try { button.setPointerCapture(event.pointerId); } catch { /* Window release remains available. */ }
        this.sync();
      }, { passive: false });
      this.listen(button, 'pointermove', event => this.move(event), { passive: false });
      for (const type of ['pointerup', 'pointercancel']) {
        this.listen(button, type, event => this.release(event.pointerId));
      }
      this.listen(button, 'lostpointercapture', event => {
        // Ignore a late loss event if this pointer has already been captured again.
        if (!button.hasPointerCapture?.(event.pointerId)) this.release(event.pointerId);
      });
      this.listen(button, 'contextmenu', event => event.preventDefault());
      this.listen(button, 'dragstart', event => event.preventDefault());
    }

    for (const type of ['blur', 'resize', 'orientationchange', 'pagehide']) {
      this.listen(windowTarget, type, () => this.clear());
    }
    for (const type of ['pointerup', 'pointercancel']) {
      this.listen(windowTarget, type, event => this.release(event.pointerId));
    }
    this.listen(documentTarget, 'visibilitychange', () => {
      if (documentTarget.hidden) this.clear();
    });
    this.sync();
  }

  listen(target, type, handler, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  }

  move(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer?.steering || !this.document?.elementFromPoint) return;
    event.preventDefault();
    const hit = this.document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-touch]');
    const isDirection = hit && this.buttons.includes(hit) && (hit.dataset.touch === 'left' || hit.dataset.touch === 'right');
    const action = isDirection ? hit.dataset.touch : null;
    if (action !== pointer.action) { pointer.action = action; this.sync(); }
  }

  release(pointerId) {
    const pointer = this.pointers.get(pointerId);
    if (!pointer) return;
    this.pointers.delete(pointerId);
    this.sync();
    try {
      if (pointer.owner.hasPointerCapture?.(pointerId)) pointer.owner.releasePointerCapture(pointerId);
    } catch { /* Capture may already have been cancelled by the browser. */ }
  }

  sync() {
    const held = new Set([...this.pointers.values()].map(pointer => pointer.action));
    Object.assign(this.state, {
      throttle: Number(held.has('throttle')),
      brake: Number(held.has('brake')),
      steer: Number(held.has('right')) - Number(held.has('left')),
      drift: held.has('drift'),
      nitro: held.has('nitro'),
    });
    for (const button of this.buttons) {
      const active = held.has(button.dataset.touch);
      button.classList.toggle('pressed', active);
      button.setAttribute('aria-pressed', String(active));
    }
    this.onChange?.(this.state);
  }

  clear() {
    const held = [...this.pointers];
    this.pointers.clear();
    this.sync();
    for (const [id, pointer] of held) {
      try { if (pointer.owner.hasPointerCapture?.(id)) pointer.owner.releasePointerCapture(id); } catch {}
    }
  }

  destroy() {
    this.clear();
    this.destroyed = true;
    for (const remove of this.listeners.splice(0)) remove();
  }
}
