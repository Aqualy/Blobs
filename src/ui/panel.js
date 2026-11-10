// Side panel: selected blob, bridge parameters, canvas and file.
import { LitElement, html, css, nothing } from './lit.js';
import { base } from './theme.js';
import { icon } from './icons.js';
import { store, StoreController } from './store.js';
import { PARAM_RANGES } from '../field.js';
import { PALETTE, BOARD_PRESETS, MOTION_TYPES } from '../model.js';
import './controls.js';

const PARAMS = [
  ['reach', 'Reach', 'How far apart blobs can be (× their radius) before the bridge is gone'],
  ['snap', 'Snap point', 'Where along the reach the neck pinches off and retracts'],
  ['thickness', 'Thickness', 'Neck thickness when blobs are close'],
  ['flare', 'Flare', 'How wide a bridge is where it grows out of a blob'],
  ['taper', 'Taper', 'Higher keeps the neck thin for longer, with a sharper flare'],
  ['smooth', 'Smoothness', 'Size of the fillets where bridges meet blobs'],
  ['organic', 'Organic', 'Per-bridge bend and asymmetry'],
  ['maxBridges', 'Max bridges', 'Most bridges one blob keeps at once; the weakest let go. 12 = no limit'],
];

const MOTION_FIELDS = {
  amp: { label: 'Distance', min: 0, max: 600, step: 1, numMax: 2000, tip: 'How far the blob travels' },
  cycles: { label: 'Speed', min: 1, max: 8, step: 1, numMax: 12, tip: 'Repeats per loop. Whole numbers keep videos seamless' },
  phase: { label: 'Offset', min: 0, max: 1, step: 0.01, tip: 'Shift this blob in time relative to the others' },
  angle: { label: 'Angle', min: -180, max: 180, step: 1, tip: 'Direction of the swing' },
  pulse: { label: 'Pulse', min: 0, max: 0.6, step: 0.01, tip: 'Breathing: grows and shrinks the radius' },
};

const ROUTES = [{ value: 'curve', label: 'Curved' }, { value: 'straight', label: 'Straight' }];
const DIRECTIONS = [{ value: 1, label: 'Clockwise' }, { value: -1, label: 'Counter' }];
const MOTIONS = MOTION_TYPES.map((t) => ({ value: t.id, label: t.label }));

export class BlPanel extends LitElement {
  static styles = [base, css`
    :host { display: block; }
    section { padding: 14px 16px 16px; border-bottom: 1px solid var(--border); }
    section:last-child { border-bottom: none; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; margin-bottom: 10px; }
    h2 { margin: 0; font-size: 11px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--grey); }
    .badge {
      font-size: 11px; color: var(--text-3); padding: 2px 8px; border-radius: 999px;
      background: var(--surface-2); border: 1px solid var(--border);
    }
    .badge.on { color: var(--lime); border-color: color-mix(in srgb, var(--lime) 35%, transparent); background: color-mix(in srgb, var(--lime) 8%, transparent); }
    .stack { display: grid; gap: 4px; }
    .row { display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; gap: 10px; min-height: 32px; }
    .lbl { color: var(--text-2); font-size: 12px; }
    .row.top { align-items: start; }
    .row.top .lbl { padding-top: 4px; }
    .sub { margin-top: 4px; padding-top: 8px; border-top: 1px dashed var(--border); }
    .actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 12px; }
    .actions .btn { padding: 0 6px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .dims { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 6px; }
    .dims .x { color: var(--text-3); font-size: 12px; }
    .dim { position: relative; }
    .dim span { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); font-size: 11px; color: var(--text-3); pointer-events: none; }
    .dim input { width: 100%; padding-left: 22px; }
    select.field { width: 100%; }
    .note { display: flex; align-items: center; gap: 6px; margin: 0 0 2px; font-size: 11.5px; color: var(--text-3); }
    .note svg { color: var(--lime); fill: var(--lime); }

    .empty { display: grid; justify-items: center; gap: 10px; padding: 10px 4px 4px; text-align: center; }
    .empty .glyph {
      display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px;
      background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2);
    }
    .empty p { margin: 0; color: var(--text-2); font-size: 12px; max-width: 250px; }
    .keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin-top: 4px; width: 100%; text-align: left; font-size: 11.5px; color: var(--text-3); }
    kbd {
      justify-self: end; font: 500 10.5px/1 var(--mono); color: var(--text-2); padding: 3px 5px; border-radius: 4px;
      background: var(--surface-2); border: 1px solid var(--border-strong); border-bottom-width: 2px; white-space: nowrap;
    }
  `];

  constructor() {
    super();
    new StoreController(this);
  }

  render() {
    const ed = store.editor;
    if (!ed?.doc) return nothing;
    return html`${this.blobSection(ed)}${this.bridgeSection(ed)}${this.canvasSection(ed)}${this.fileSection(ed)}`;
  }

  blobSection(ed) {
    const sel = ed.selected();
    const n = sel.length;
    return html`<section aria-label="Blob">
      <header>
        <h2>Blob</h2>
        <span class="badge ${n ? 'on' : ''}">${n === 0 ? 'None selected' : n === 1 ? '1 selected' : `${n} selected`}</span>
      </header>
      ${n === 0 ? this.emptyState() : this.blobBody(ed, sel[0])}
    </section>`;
  }

  emptyState() {
    return html`<div class="empty">
      <div class="glyph">${icon('pointer', 18)}</div>
      <p>Select a blob to edit it. Shift-click or drag a box to select several.</p>
      <div class="keys">
        <kbd>Double-click</kbd><span>Add a blob</span>
        <kbd>Space + drag</kbd><span>Pan the canvas</span>
        <kbd>[ ]</kbd><span>Shrink or grow the selection</span>
        <kbd>Alt + drag</kbd><span>Duplicate while moving</span>
        <kbd>J / L</kbd><span>Previous / next keyframe</span>
      </div>
    </div>`;
  }

  blobBody(ed, b) {
    const m = b.motion;
    const moving = m.type !== 'none';
    const keyedR = b.keys.r.length > 0;
    const keyedPos = b.keys.pos.length > 0;
    const radius = keyedR ? ed.baseValue(b).r : b.r;
    const motionSlider = (key) => {
      const f = MOTION_FIELDS[key];
      return html`<bl-slider label=${f.label} title=${f.tip} .value=${m[key]} min=${f.min} max=${f.max} step=${f.step}
        num-max=${f.numMax ?? f.max}
        @bl-input=${(e) => ed.setMotion(key, e.detail)} @bl-change=${() => ed.commit()}></bl-slider>`;
    };
    return html`<div class="stack">
      <bl-slider label=${keyedR ? 'Radius ◆' : 'Radius'} .value=${radius} min=${keyedR ? 0 : 4} max="600" step="1" num-max="2000"
        title=${keyedR ? 'Size is keyframed: changing it sets a key at the playhead' : ''}
        @bl-input=${(e) => ed.setRadius(e.detail)} @bl-change=${() => ed.commit()}></bl-slider>
      ${keyedPos || keyedR ? html`<p class="note">${icon('diamond', 12)}
        <span>${[keyedPos && 'Position', keyedR && 'size'].filter(Boolean).join(' and ')} keyframed. Edits set a key at the playhead.</span></p>` : nothing}
      ${b.keys.pos.length > 2 ? html`<div class="row">
        <span class="lbl">Route</span>
        <bl-segmented label="Route" .options=${ROUTES} .value=${b.keys.curve !== false ? 'curve' : 'straight'}
          title="How the path runs through the position keys"
          @bl-change=${(e) => ed.setCurve(e.detail === 'curve')}></bl-segmented>
      </div>` : nothing}
      <div class="row top">
        <span class="lbl">Colour</span>
        <bl-swatches label="Colour" .palette=${PALETTE} .value=${b.color}
          @bl-input=${(e) => ed.setBlobColor(e.detail)}
          @bl-change=${(e) => { ed.setBlobColor(e.detail); ed.commit(); }}></bl-swatches>
      </div>
      <div class="row">
        <span class="lbl">Motion</span>
        <bl-segmented label="Motion" .options=${MOTIONS} .value=${m.type}
          @bl-change=${(e) => ed.setMotionType(e.detail)}></bl-segmented>
      </div>
      ${moving ? html`<div class="stack sub">
        ${motionSlider('amp')}
        ${motionSlider('cycles')}
        ${motionSlider('phase')}
        ${m.type === 'swing' ? motionSlider('angle') : nothing}
        ${m.type === 'orbit' ? html`<div class="row">
          <span class="lbl">Direction</span>
          <bl-segmented label="Direction" .options=${DIRECTIONS} .value=${m.angle < 0 ? -1 : 1}
            @bl-change=${(e) => ed.setDirection(Number(e.detail))}></bl-segmented>
        </div>` : nothing}
      </div>` : nothing}
      ${motionSlider('pulse')}
    </div>
    <div class="actions">
      <button class="btn" title="Duplicate (Ctrl+D)" @click=${() => ed.duplicate()}>${icon('duplicate', 15)}Duplicate</button>
      <button class="btn" title="Bring to front" @click=${() => ed.toFront()}>${icon('front', 15)}To front</button>
      <button class="btn danger" title="Delete (Del)" @click=${() => ed.remove()}>${icon('trash', 15)}Delete</button>
    </div>`;
  }

  bridgeSection(ed) {
    const p = ed.doc.params;
    return html`<section aria-label="Bridges">
      <header>
        <h2>Bridges</h2>
        <button class="btn link" title="Reset bridge settings to defaults" @click=${() => ed.resetParams()}>${icon('reset', 13)}Reset</button>
      </header>
      <div class="stack">
        ${PARAMS.map(([key, label, tip]) => {
          const [min, max, step] = PARAM_RANGES[key];
          return html`<bl-slider label=${label} title=${tip} .value=${p[key]} min=${min} max=${max} step=${step}
            @bl-input=${(e) => ed.setParam(key, e.detail)} @bl-change=${() => ed.commit()}></bl-slider>`;
        })}
        <bl-switch class="sub" label="No overlap" description="Bridges never cross or merge into each other"
          title="When on, a bridge that would cross or merge into another pinches off and retracts"
          .checked=${!!p.noOverlap} @bl-change=${(e) => ed.setNoOverlap(e.detail)}></bl-switch>
      </div>
    </section>`;
  }

  canvasSection(ed) {
    const doc = ed.doc;
    const preset = BOARD_PRESETS.find((b) => b.w === doc.board.w && b.h === doc.board.h);
    const dim = (axis, value) => html`<label class="dim">
      <span>${axis}</span>
      <input class="field num" type="number" min="64" max="8192" step="1" .value=${String(value)} aria-label=${axis === 'W' ? 'Width' : 'Height'}
        @change=${(e) => (axis === 'W' ? ed.setBoardSize(parseFloat(e.target.value), doc.board.h) : ed.setBoardSize(doc.board.w, parseFloat(e.target.value)))}
        @keydown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}>
    </label>`;
    return html`<section aria-label="Canvas">
      <header><h2>Canvas</h2></header>
      <div class="stack">
        <div class="row">
          <span class="lbl">Size</span>
          <select class="field" aria-label="Canvas size" @change=${(e) => ed.setBoardPreset(e.target.value)}>
            ${BOARD_PRESETS.map((b) => html`<option value=${b.id} ?selected=${preset === b}>${b.label}</option>`)}
            <option value="custom" ?selected=${!preset}>Custom</option>
          </select>
        </div>
        <div class="row">
          <span></span>
          <div class="dims">${dim('W', doc.board.w)}<span class="x">×</span>${dim('H', doc.board.h)}</div>
        </div>
        <div class="row top">
          <span class="lbl">Background</span>
          <bl-swatches label="Background" .palette=${PALETTE} .value=${doc.background}
            @bl-input=${(e) => ed.setBackground(e.detail)}
            @bl-change=${(e) => { ed.setBackground(e.detail); ed.commit(); }}></bl-swatches>
        </div>
        <bl-switch label="Transparent background"
          .checked=${!!doc.transparent} @bl-change=${(e) => ed.setTransparent(e.detail)}></bl-switch>
        <bl-slider class="sub" label="Loop" title="Length of one seamless animation loop, in seconds"
          .value=${doc.loop} min="1" max="30" step="0.5" num-max="60"
          @bl-input=${(e) => ed.setLoop(e.detail)} @bl-change=${() => ed.commit()}></bl-slider>
      </div>
    </section>`;
  }

  fileSection(ed) {
    return html`<section aria-label="File">
      <header><h2>File</h2></header>
      <div class="grid2">
        <button class="btn" title="Start an empty composition" @click=${() => ed.newDoc()}>${icon('file', 15)}New</button>
        <button class="btn" title="Open a .json composition" @click=${() => this.renderRoot.getElementById('file').click()}>${icon('folder', 15)}Open…</button>
        <button class="btn" title="Save as .json (Ctrl+S)" @click=${() => ed.saveJSON()}>${icon('save', 15)}Save .json</button>
        <button class="btn" title="Copy a link that opens this composition" @click=${() => ed.copyLink()}>${icon('link', 15)}Copy link</button>
      </div>
      <input id="file" type="file" accept=".json,application/json" hidden
        @change=${(e) => { const f = e.target.files?.[0]; if (f) ed.openFile(f); e.target.value = ''; }}>
    </section>`;
  }
}

customElements.define('bl-panel', BlPanel);
