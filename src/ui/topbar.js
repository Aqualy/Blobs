// Top bar (presets, history, transport, add, export) and the zoom pill.
import { LitElement, html, css, nothing } from './lit.js';
import { base } from './theme.js';
import { icon } from './icons.js';
import { store, StoreController } from './store.js';
import { PRESETS } from '../model.js';

export class BlTopbar extends LitElement {
  static styles = [base, css`
    :host { display: block; background: var(--surface-1); border-bottom: 1px solid var(--border); }
    .bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; min-height: 52px; flex-wrap: wrap; }
    .brand { display: flex; align-items: center; gap: 9px; margin-right: 6px; font-weight: 700; font-size: 15px; letter-spacing: .01em; }
    .brand img { display: block; }
    .sep { width: 1px; height: 20px; background: var(--border-strong); margin: 0 4px; }
    .group { display: flex; align-items: center; gap: 4px; }
    .spacer { flex: 1; }
    select.field { height: var(--ctl-h); width: 150px; }

    .transport {
      display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 12px 0 3px;
      background: var(--field); border: 1px solid var(--border); border-radius: 999px;
    }
    .play {
      display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border-radius: 50%; border: none;
      background: var(--lime); color: var(--lime-ink); cursor: pointer; transition: background .12s, transform .08s;
    }
    .play:hover { background: var(--lime-hover); }
    .play:active { transform: scale(.94); }
    .play:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .range { width: clamp(90px, 18vw, 260px); }
    .clock { font-size: 12px; color: var(--text-2); min-width: 86px; white-space: nowrap; }
    .clock b { color: var(--text); font-weight: 500; }

    @media (max-width: 860px) {
      .brand span, .sep { display: none; }
      .bar { gap: 6px; padding: 8px 10px; }
      .brand { margin-right: 0; }
      select.field { width: 104px; }
      .add-label { display: none; }
      .transport { order: 10; flex: 1 1 100%; }
      .transport .range { flex: 1; width: auto; }
    }
  `];

  constructor() {
    super();
    new StoreController(this, ['change', 'time']);
    this.scrubbing = false;
  }

  render() {
    const ed = store.editor;
    if (!ed?.doc) return nothing;
    const st = ed.state;
    const loop = ed.doc.loop;
    const frac = st.time / loop;
    return html`<div class="bar">
      <div class="brand"><img src="favicon.svg" width="22" height="22" alt=""><span>Blobs</span></div>

      <select class="field" title="Load a preset composition" aria-label="Presets"
        @change=${(e) => { const i = Number(e.target.value); e.target.selectedIndex = 0; e.target.blur(); ed.loadPreset(i); }}>
        <option value="" disabled selected>Presets…</option>
        ${PRESETS.map((p, i) => html`<option value=${i}>${p.name}</option>`)}
      </select>

      <span class="sep"></span>
      <div class="group">
        <button class="btn icon ghost" title="Undo (Ctrl+Z)" aria-label="Undo" ?disabled=${!ed.canUndo()} @click=${() => ed.undo()}>${icon('undo', 17)}</button>
        <button class="btn icon ghost" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" ?disabled=${!ed.canRedo()} @click=${() => ed.redo()}>${icon('redo', 17)}</button>
      </div>
      <span class="sep"></span>

      <div class="transport">
        <button class="play" title="Play / pause (Space)" aria-label=${st.playing ? 'Pause' : 'Play'} @click=${() => ed.togglePlay()}>
          ${icon(st.playing ? 'pause' : 'play', 14)}
        </button>
        <input class="range" type="range" min="0" max="1000" step="1" aria-label="Timeline"
          .value=${this.scrubbing ? this.renderRoot.querySelector('.range')?.value ?? '0' : String(Math.round(frac * 1000))}
          style="--fill:${frac * 100}%"
          @pointerdown=${() => { this.scrubbing = true; }}
          @pointerup=${() => { this.scrubbing = false; }}
          @change=${() => { this.scrubbing = false; }}
          @input=${(e) => ed.scrub(Number(e.target.value) / 1000)}>
        <span class="clock mono"><b>${st.time.toFixed(2)}s</b> / ${loop}s</span>
      </div>

      <div class="spacer"></div>

      <div class="group">
        <button class="btn" title="Add blob (A, or double-click the canvas)" @click=${() => ed.addBlob()}>${icon('plus', 15)}<span class="add-label">Add blob</span></button>
        <button class="btn primary" title="Export PNG, SVG or video" @click=${() => ed.openExport()}>${icon('download', 15)}Export</button>
      </div>
    </div>`;
  }
}

export class BlZoombar extends LitElement {
  static styles = [base, css`
    :host {
      display: flex; align-items: center; gap: 2px; padding: 3px;
      background: rgba(24, 24, 26, .88); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: 0 4px 14px rgba(0,0,0,.3); backdrop-filter: blur(6px);
    }
    .btn.sm { border-color: transparent; background: transparent; color: var(--text-2); }
    .btn.sm:hover { background: var(--surface-3); color: var(--text); }
    .zoom { min-width: 54px; font-family: var(--mono); font-size: 11.5px; }
    .sep { width: 1px; height: 16px; background: var(--border-strong); margin: 0 2px; }
  `];

  constructor() {
    super();
    new StoreController(this);
  }

  render() {
    const ed = store.editor;
    if (!ed?.doc) return nothing;
    return html`
      <button class="btn icon sm" title="Zoom out (−)" aria-label="Zoom out" @click=${() => ed.zoomBy(0.8)}>${icon('minus', 15)}</button>
      <button class="btn sm zoom" title="Zoom to fit (F)" @click=${() => ed.fitView()}>${Math.round(ed.state.view.zoom * 100)}%</button>
      <button class="btn icon sm" title="Zoom in (+)" aria-label="Zoom in" @click=${() => ed.zoomBy(1.25)}>${icon('plus', 15)}</button>
      <span class="sep"></span>
      <button class="btn icon sm" title="Fit to screen (F)" aria-label="Fit to screen" @click=${() => ed.fitView()}>${icon('fit', 15)}</button>
    `;
  }
}

customElements.define('bl-topbar', BlTopbar);
customElements.define('bl-zoombar', BlZoombar);
