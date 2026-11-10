// Export dialog and toast notifications.
import { LitElement, html, css } from './lit.js';
import { base } from './theme.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { ANIMATION_FORMATS, FRAME_RATES, animationSize } from '../export.js';

const PREFS_KEY = 'blobs:export:v1';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

export class BlExportDialog extends LitElement {
  static properties = {
    busy: { state: true },
    progress: { state: true },
    status: { state: true },
    scale: { state: true },
    support: { state: true },
    format: { state: true },
    fps: { state: true },
    transparent: { state: true },
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
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 16px 20px 20px; }
    .anim { grid-column: 1 / -1; }
    .anim .top { display: flex; align-items: center; gap: 10px; }
    .anim .top p { margin-top: 2px; }
    .form { display: grid; grid-template-columns: 92px minmax(0, 1fr); align-items: center; gap: 8px 12px; }
    .form > label { font-size: 12px; color: var(--text-2); }
    .anim .seg button { white-space: nowrap; padding: 0 8px; }
    .seg button:disabled { opacity: .38; cursor: not-allowed; }
    .seg button:disabled:hover { color: var(--text-2); }
    .note { font-size: 11.5px; color: var(--text-3); }
    .note.warn { color: var(--text-2); }
    .meta { font-size: 11.5px; color: var(--text-2); }
    .actions { display: flex; align-items: center; gap: 12px; }
    .actions .meta { flex: 1; }
    .card.anim .btn.primary { width: auto; min-width: 150px; }
    .sw { display: inline-flex; align-items: center; gap: 10px; background: none; border: none; padding: 2px 0; color: var(--text); font-size: 12px; cursor: pointer; }
    .sw:disabled { cursor: not-allowed; opacity: .45; }
    .sw .track { position: relative; width: 32px; height: 18px; border-radius: 999px; background: var(--track); transition: background .15s; }
    .sw .track::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
      background: var(--thumb); box-shadow: 0 1px 3px rgba(0,0,0,.4); transition: transform .15s ease;
    }
    .sw[aria-checked="true"] .track { background: var(--lime); }
    .sw[aria-checked="true"] .track::after { transform: translateX(14px); background: var(--lime-ink); }
    .sw:focus-visible { outline: none; }
    .sw:focus-visible .track { box-shadow: 0 0 0 2px var(--surface-2), 0 0 0 4px var(--focus); }
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
    @media (max-width: 700px) {
      .grid { grid-template-columns: 1fr; }
      .form { grid-template-columns: 1fr; gap: 4px; }
      .form > label { margin-top: 6px; }
      .form > .spacer { display: none; }
      .seg { flex-wrap: wrap; }
      .actions { flex-direction: column; align-items: stretch; }
      .card.anim .btn.primary { width: 100%; }
    }
  `];

  constructor() {
    super();
    this.busy = false;
    this.progress = 0;
    this.status = '';
    this.scale = 1;
    this.support = null;
    const prefs = loadPrefs();
    this.format = ANIMATION_FORMATS[prefs.format] ? prefs.format : 'mp4';
    this.fps = FRAME_RATES.includes(prefs.fps) ? prefs.fps : 30;
    this.transparent = false;
    this.abort = null;
  }

  get isOpen() { return !!this.renderRoot?.querySelector('dialog')?.open; }

  show() {
    const ed = store.editor;
    this.transparent = !!ed.doc.transparent;
    this.support = null;
    ed.animationSupport().then((sup) => {
      this.support = sup;
      if (!sup[this.format]?.ok) this.format = Object.keys(sup).find((k) => sup[k].ok) || this.format;
    }).catch((err) => console.error(err));
    this.renderRoot.querySelector('dialog').showModal();
    store.modal = true;
  }

  render() {
    const pct = Math.round(this.progress * 100);
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
        ${this.renderAnimation()}
      </div>
      <div class="progress" ?hidden=${!this.busy}>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct}><div style="width:${pct}%"></div></div>
        <span class="status mono">${this.status || `${pct}%`}</span>
        <button class="btn sm" @click=${() => this.abort?.abort()} ?hidden=${!this.abort}>Cancel</button>
      </div>
    </dialog>`;
  }

  renderAnimation() {
    const doc = store.editor?.doc;
    if (!doc) return '';
    const sup = this.support;
    const f = ANIMATION_FORMATS[this.format];
    const s = sup?.[this.format];
    const fps = Math.min(this.fps, f.maxFps);
    const canAlpha = !!f.alpha && (!s || s.alpha);
    const transparent = this.transparent && canAlpha;
    const { w, h } = animationSize(doc, this.format);
    const frames = Math.max(1, Math.round(doc.loop * fps));
    let alphaNote = '';
    if (!f.alpha) alphaNote = `${f.label} cannot store transparency, so the background colour is used.`;
    else if (s && !s.alpha) alphaNote = 'This browser cannot encode transparent WebM. Use APNG or PNG frames.';
    else if (transparent && this.format === 'gif') alphaNote = 'GIF transparency is on or off per pixel, so soft edges become hard.';
    const realtime = s?.realtime ? ' · recorded in real time' : '';
    return html`<div class="card anim">
      <div class="top">
        <div class="glyph">${icon('video', 18)}</div>
        <div><h3>Animation</h3><p>One seamless ${doc.loop}s loop, rendered frame by frame.</p></div>
      </div>
      <div class="form">
        <label id="fmt-l">Format</label>
        <div class="seg" role="radiogroup" aria-labelledby="fmt-l">
          ${Object.entries(ANIMATION_FORMATS).map(([k, v]) => {
            const ok = !sup || sup[k]?.ok;
            return html`<button type="button" role="radio" aria-checked=${this.format === k} class=${this.format === k ? 'on' : ''}
              ?disabled=${!ok || this.busy} title=${ok ? v.note : 'Not supported in this browser'}
              @click=${() => this.setPref({ format: k })}>${v.label}</button>`;
          })}
        </div>
        <span class="spacer"></span><span class="note">${f.note}</span>
        <label id="fps-l">Frame rate</label>
        <div class="seg" role="radiogroup" aria-labelledby="fps-l">
          ${FRAME_RATES.map((r) => html`<button type="button" role="radio" aria-checked=${fps === r} class=${fps === r ? 'on' : ''}
            ?disabled=${r > f.maxFps || this.busy} title=${r > f.maxFps ? `${f.label} plays at most ${f.maxFps} fps` : `${r} frames per second`}
            @click=${() => this.setPref({ fps: r })}>${r}</button>`)}
        </div>
        <label id="bg-l">Background</label>
        <div>
          <button type="button" class="sw" role="switch" aria-labelledby="bg-l" aria-checked=${transparent}
            ?disabled=${!canAlpha || this.busy} @click=${() => { this.transparent = !this.transparent; }}>
            <span class="track"></span>${transparent ? 'Transparent' : 'Solid colour'}
          </button>
        </div>
        ${alphaNote ? html`<span class="spacer"></span><span class="note warn">${alphaNote}</span>` : ''}
      </div>
      <div class="actions">
        <span class="meta mono">${w} × ${h} px · ${fps} fps · ${frames} frames${realtime}</span>
        <button class="btn primary" ?disabled=${this.busy || (sup && !s?.ok)} @click=${this.animation}>Export ${f.label}</button>
      </div>
    </div>`;
  }

  setPref(p) {
    if (p.format) this.format = p.format;
    if (p.fps) this.fps = p.fps;
    savePrefs({ format: this.format, fps: this.fps });
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

  animation = () => {
    const ac = new AbortController();
    this.abort = ac;
    const f = ANIMATION_FORMATS[this.format];
    const opts = {
      format: this.format,
      fps: Math.min(this.fps, f.maxFps),
      transparent: this.transparent && !!f.alpha && this.support?.[this.format]?.alpha !== false,
    };
    return this.run('Rendering…', () => store.editor.exportAnimation(opts, ac.signal, (p, i, n) => {
      this.progress = p;
      this.status = `${i} / ${n}`;
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
