// Export dialog and toast notifications.
import { LitElement, html, css } from './lit.js';
import { base } from './theme.js';
import { icon } from './icons.js';
import { store } from './store.js';

export class BlExportDialog extends LitElement {
  static properties = {
    busy: { state: true },
    progress: { state: true },
    status: { state: true },
    scale: { state: true },
    video: { state: true },
    loop: { state: true },
  };

  static styles = [base, css`
    dialog {
      width: min(760px, calc(100vw - 32px)); padding: 0; color: var(--text);
      background: var(--surface-1); border: 1px solid var(--border-strong); border-radius: var(--r-l);
      box-shadow: var(--shadow-pop);
    }
    dialog[open] { animation: pop .16s ease-out; }
    dialog::backdrop { background: rgba(0, 0, 0, .55); backdrop-filter: blur(2px); }
    @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.985); } }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 0 20px; }
    h2 { margin: 0; font-size: 15px; font-weight: 650; }
    .sub { margin: 2px 0 0; font-size: 12px; color: var(--text-2); }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 16px 20px 20px; }
    .card {
      display: flex; flex-direction: column; gap: 10px; padding: 14px;
      background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-m);
    }
    .glyph {
      display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px;
      background: color-mix(in srgb, var(--lime) 12%, transparent); color: var(--lime);
    }
    h3 { margin: 0; font-size: 13px; font-weight: 600; }
    p { margin: 0; flex: 1; font-size: 12px; color: var(--text-2); }
    .card .btn.primary { width: 100%; }
    .seg { display: flex; padding: 2px; gap: 2px; background: var(--field); border: 1px solid var(--border); border-radius: 8px; }
    .seg button {
      flex: 1; height: 24px; border: none; border-radius: 6px; background: transparent;
      color: var(--text-2); font-size: 12px; font-weight: 500; cursor: pointer;
    }
    .seg button:hover { color: var(--text); }
    .seg button.on { background: var(--surface-3); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.35); }
    .seg button:focus-visible { outline: 2px solid var(--focus); outline-offset: -1px; }
    .progress { display: flex; align-items: center; gap: 12px; padding: 0 20px 18px; }
    .bar { flex: 1; height: 6px; border-radius: 999px; background: var(--track); overflow: hidden; }
    .bar div { height: 100%; background: var(--lime); border-radius: inherit; transition: width .12s; }
    .status { min-width: 92px; font-size: 12px; color: var(--text-2); text-align: right; }
    @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
  `];

  constructor() {
    super();
    this.busy = false;
    this.progress = 0;
    this.status = '';
    this.scale = 1;
    this.video = '';
    this.loop = 0;
    this.abort = null;
  }

  get isOpen() { return !!this.renderRoot?.querySelector('dialog')?.open; }

  show() {
    const ed = store.editor;
    this.video = ed.videoSupport() || '';
    this.loop = ed.doc.loop;
    this.renderRoot.querySelector('dialog').showModal();
    store.modal = true;
  }

  render() {
    const pct = Math.round(this.progress * 100);
    const fmt = this.video.includes('mp4') ? 'MP4' : 'WebM';
    return html`<dialog aria-labelledby="t" @close=${this.onClose}>
      <div class="head">
        <div><h2 id="t">Export</h2><p class="sub">Every export covers the full artboard.</p></div>
        <button class="btn icon ghost" aria-label="Close" @click=${() => this.renderRoot.querySelector('dialog').close()}>${icon('x', 17)}</button>
      </div>
      <div class="grid">
        <div class="card">
          <div class="glyph">${icon('image', 18)}</div>
          <h3>PNG</h3>
          <p>Pixel image of the current frame.</p>
          <div class="seg" role="radiogroup" aria-label="PNG scale">
            ${[1, 2, 4].map((s) => html`<button type="button" role="radio" aria-checked=${this.scale === s}
              class=${this.scale === s ? 'on' : ''} @click=${() => { this.scale = s; }}>${s}×</button>`)}
          </div>
          <button class="btn primary" ?disabled=${this.busy} @click=${this.png}>Download PNG</button>
        </div>
        <div class="card">
          <div class="glyph">${icon('vector', 18)}</div>
          <h3>SVG</h3>
          <p>Vector outline of the current frame. Where colours blend, the SVG uses crisp colour regions.</p>
          <button class="btn primary" ?disabled=${this.busy} @click=${this.svg}>Download SVG</button>
        </div>
        <div class="card">
          <div class="glyph">${icon('video', 18)}</div>
          <h3>Video</h3>
          <p>${this.video
            ? `Records one seamless ${this.loop}s loop in real time (${fmt}).`
            : 'Video recording is not supported in this browser.'}</p>
          <button class="btn primary" ?disabled=${this.busy || !this.video} @click=${this.record}>Record video</button>
        </div>
      </div>
      <div class="progress" ?hidden=${!this.busy}>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct}><div style="width:${pct}%"></div></div>
        <span class="status mono">${this.status || `${pct}%`}</span>
        <button class="btn sm" @click=${() => this.abort?.abort()} ?hidden=${!this.abort}>Cancel</button>
      </div>
    </dialog>`;
  }

  onClose() {
    store.modal = false;
    this.abort?.abort();
  }

  async run(status, task) {
    this.busy = true;
    this.progress = 0;
    this.status = status;
    try { await task(); } finally {
      this.busy = false;
      this.abort = null;
      this.status = '';
    }
  }

  png = () => this.run('Rendering…', () => store.editor.exportPNG(this.scale));

  svg = () => this.run('', () => store.editor.exportSVG((p) => { this.progress = p; }));

  record = () => {
    const ac = new AbortController();
    this.abort = ac;
    const loop = store.editor.doc.loop;
    return this.run('Recording…', () => store.editor.recordVideo(ac.signal, (p) => {
      this.progress = p;
      this.status = `${(p * loop).toFixed(1)}s / ${loop}s`;
    }));
  };
}

export class BlToasts extends LitElement {
  static properties = { items: { state: true } };

  static styles = [base, css`
    :host { display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
    .toast {
      display: flex; align-items: center; gap: 9px; max-width: min(90vw, 480px); padding: 9px 14px;
      background: #232326; border: 1px solid var(--border-strong); border-radius: 10px;
      box-shadow: var(--shadow-pop); font-size: 12.5px; animation: in .18s ease-out; transition: opacity .3s, transform .3s;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--lime); flex: none; }
    .toast.error { border-color: color-mix(in srgb, var(--danger) 60%, transparent); }
    .toast.error .dot { background: var(--danger); }
    .toast.out { opacity: 0; transform: translateY(4px); }
    @keyframes in { from { transform: translateY(8px); opacity: 0; } }
  `];

  constructor() {
    super();
    this.items = [];
    this.seq = 0;
  }

  /** @param {string} msg */
  show(msg, { error = false, ms = 2600 } = {}) {
    const item = { id: ++this.seq, msg, error, out: false };
    this.items = [...this.items, item];
    setTimeout(() => {
      item.out = true;
      this.requestUpdate();
      setTimeout(() => { this.items = this.items.filter((x) => x !== item); }, 320);
    }, ms);
  }

  render() {
    return html`<div role="status" aria-live="polite" style="display:contents">
      ${this.items.map((t) => html`<div class="toast ${t.error ? 'error' : ''} ${t.out ? 'out' : ''}"><span class="dot"></span>${t.msg}</div>`)}
    </div>`;
  }
}

customElements.define('bl-export-dialog', BlExportDialog);
customElements.define('bl-toasts', BlToasts);
