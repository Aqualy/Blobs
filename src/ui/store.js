// Connects the Lit components to the editor in app.js.
// app.js assigns store.editor and calls notify(); components re-render.

export const store = {
  /** @type {any} the editor API from app.js */
  editor: null,
  /** True while a modal dialog is open (keyboard shortcuts pause). */
  modal: false,
};

const bus = new EventTarget();

/**
 * 'change': document, selection, history or view changed.
 * 'time':   the playhead moved (every animation frame while playing).
 */
export function notify(kind = 'change') {
  bus.dispatchEvent(new Event(kind));
}

/** Lit reactive controller: re-render the host on the given store events. */
export class StoreController {
  constructor(host, kinds = ['change']) {
    this.host = host;
    this.kinds = kinds;
    this.update = () => host.requestUpdate();
    host.addController(this);
  }
  hostConnected() { for (const k of this.kinds) bus.addEventListener(k, this.update); }
  hostDisconnected() { for (const k of this.kinds) bus.removeEventListener(k, this.update); }
}

/**
 * Dispatch a custom event from a component host. It bubbles but is not
 * composed, so it stays inside the shadow root the component lives in.
 */
export function emit(el, name, detail) {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
}
