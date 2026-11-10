// Keyframe timeline, After Effects style.
//
// One row per blob; the selected blobs open up into a Position and a Size
// row. Each property has a stopwatch (start or stop animating it), a key
// navigator (previous key, add/remove key at the playhead, next key) and a lane
// of keyframes. Keys can be clicked, shift-clicked, dragged in time,
// double-clicked to toggle easing, and deleted with Delete. With a track
// animated, any edit of that property on the canvas or in the panel sets a key
// at the playhead.
import { LitElement, html, css, nothing } from './lit.js';
import { base } from './theme.js';
import { icon } from './icons.js';
import { store, StoreController, subscribe } from './store.js';
import { keyAt, KEY_EPS } from '../keys.js';

const COLLAPSE_KEY = 'blobs:timeline:collapsed';
const TRACK_LABEL = { pos: 'Position', r: 'Size' };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const fmtT = (t) => `${t.toFixed(2)}s`;

export class BlTimeline extends LitElement {
  static properties = { collapsed: { state: true } };

  static styles = [base, css`
    :host {
      display: flex; flex-direction: column; min-height: 0;
      background: var(--surface-1); border-top: 1px solid var(--border);
      --label-w: 196px;
    }
    .head { display: flex; align-items: center; gap: 8px; padding: 5px 10px; min-height: 40px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .title { display: flex; align-items: center; gap: 6px; background: none; border: none; padding: 2px 4px; cursor: pointer; border-radius: 6px; }
    .title:hover { background: var(--surface-2); }
    .title:focus-visible { outline: 2px solid var(--focus); }
    .title h2 { margin: 0; font-size: 11px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--grey); }
    .title .chev { transition: transform .15s; color: var(--text-3); }
    :host([collapsed]) .title .chev { transform: rotate(-90deg); }
    .clock { font-size: 12px; color: var(--text-2); }
    .clock b { color: var(--text); font-weight: 500; }
    .spacer { flex: 1; }
    .hint { font-size: 11.5px; color: var(--text-3); }
    .insp { display: flex; align-items: center; gap: 6px; padding-left: 8px; border-left: 1px solid var(--border-strong); }
    .insp .lbl { font-size: 12px; color: var(--text-2); }
    .insp .field { height: 26px; width: 68px; padding: 0 6px; }
    .insp bl-segmented { width: 132px; }

    .body { position: relative; overflow: auto; max-height: 232px; scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent; }
    .grid { display: grid; grid-template-columns: var(--label-w) minmax(0, 1fr); position: relative; min-width: 520px; }
    .lbl-cell {
      position: sticky; left: 0; z-index: 2; display: flex; align-items: center; gap: 4px; min-width: 0;
      height: 26px; padding: 0 6px 0 10px; background: var(--surface-1); border-right: 1px solid var(--border);
      border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); font-size: 12px;
    }
    .lane {
      position: relative; height: 26px; margin: 0 14px;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    }
    .lane-wrap { position: relative; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
    .lane-wrap .lane { border-bottom: none; }
    .blobrow { cursor: pointer; }
    .blobrow.sel, .lane-wrap.sel { background: color-mix(in srgb, var(--lime) 5%, transparent); }
    .blobrow .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .blobrow.sel .name { color: var(--lime); }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); }
    .prop { padding-left: 26px; color: var(--text-2); }
    .prop .name { flex: 1; min-width: 0; }
    .prop.on .name { color: var(--text); }
    .ib {
      display: grid; place-items: center; width: 20px; height: 20px; padding: 0; flex: none;
      border: none; border-radius: 5px; background: transparent; color: var(--text-3); cursor: pointer;
    }
    .ib:hover { background: var(--surface-3); color: var(--text); }
    .ib:focus-visible { outline: 2px solid var(--focus); outline-offset: -1px; }
    .ib.on { color: var(--lime); }
    .ib:disabled { opacity: .3; pointer-events: none; }
    .ib.key.on svg { fill: var(--lime); }

    /* ruler */
    .ruler-lbl { position: sticky; top: 0; z-index: 3; }
    .ruler-wrap { position: sticky; top: 0; z-index: 2; background: var(--surface-1); border-bottom: 1px solid var(--border); cursor: ew-resize; }
    .ruler { position: relative; height: 24px; margin: 0 14px; }
    .tick { position: absolute; bottom: 0; width: 1px; height: 5px; background: var(--border-hover); }
    .tick.major { height: 9px; background: var(--text-3); }
    .tick span { position: absolute; bottom: 10px; left: 0; transform: translateX(-50%); font: 10.5px var(--mono); color: var(--text-3); white-space: nowrap; }

    /* keys */
    .k {
      position: absolute; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; padding: 0;
      background: var(--surface-1); border: 1.5px solid var(--text-2); transform: rotate(45deg); border-radius: 1.5px;
      cursor: grab; touch-action: none;
    }
    .k.ease { border-radius: 50%; transform: none; }
    .k:hover { border-color: var(--text); }
    .k.sel { background: var(--lime); border-color: var(--lime); }
    .k.out { opacity: .35; }
    .k.sum { width: 8px; height: 8px; margin: -4px 0 0 -4px; border-width: 1px; background: var(--surface-3); border-color: var(--text-3); }
    .k.sum.sel { background: var(--lime); border-color: var(--lime); }
    .k:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .span { position: absolute; top: 50%; height: 2px; margin-top: -1px; background: color-mix(in srgb, var(--lime) 28%, transparent); pointer-events: none; }

    /* playhead, laid over the lane column */
    .ph-layer { position: absolute; top: 0; bottom: 0; left: calc(var(--label-w) + 14px); right: 14px; pointer-events: none; z-index: 4; }
    .ph { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--lime); }
    .ph::before {
      content: ""; position: absolute; top: 0; left: -5px; width: 11px; height: 10px; background: var(--lime);
      clip-path: polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%);
    }
    .empty { padding: 14px; color: var(--text-3); font-size: 12px; }
    @media (max-width: 860px) {
      :host { --label-w: 150px; }
      .hint { display: none; }
    }
  `];

  constructor() {
    super();
    new StoreController(this);
    this.collapsed = false;
    try { this.collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { /* ignore */ }
    this.drag = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.unsub = subscribe('time', () => this.syncTime());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsub?.();
  }

  /** Cheap per-frame update: only the playhead and the clock move. */
  syncTime() {
    const ed = store.editor;
    if (!ed?.doc) return;
    const ph = this.renderRoot.querySelector('.ph');
    if (ph) ph.style.left = `${clamp(ed.state.time / ed.doc.loop, 0, 1) * 100}%`;
    // Not a Lit binding: written only here, every frame.
    const clock = this.renderRoot.querySelector('.clock b.now');
    if (clock) clock.textContent = fmtT(ed.state.time);
  }

  updated() {
    this.toggleAttribute('collapsed', this.collapsed);
    this.syncTime();
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    try { localStorage.setItem(COLLAPSE_KEY, this.collapsed ? '1' : '0'); } catch { /* ignore */ }
    // The stage gets taller or shorter; let the canvas refit.
    window.dispatchEvent(new Event('resize'));
  }

  render() {
    const ed = store.editor;
    if (!ed?.doc) return nothing;
    const doc = ed.doc;
    const st = ed.state;
    return html`
      <div class="head">
        <button class="title" aria-expanded=${!this.collapsed} title="Show or hide the timeline" @click=${this.toggleCollapsed}>
          <span class="chev">${icon('chevD', 14)}</span><h2>Timeline</h2>
        </button>
        <span class="clock mono"><b class="now"></b> / ${doc.loop}s</span>
        ${this.inspector(ed)}
        <span class="spacer"></span>
        <span class="hint">${st.selection.size
          ? 'Click the stopwatch to animate a property, then move the playhead and edit the blob'
          : 'Select a blob to keyframe its position and size'}</span>
      </div>
      ${this.collapsed ? nothing : html`<div class="body">
        <div class="grid">
          <div class="lbl-cell ruler-lbl"><span class="hint">J / L: previous / next key</span></div>
          <div class="ruler-wrap" @pointerdown=${this.onRulerDown}>
            <div class="ruler">${this.ticks(doc.loop)}</div>
          </div>
          ${doc.blobs.length ? doc.blobs.map((b) => this.blobRows(ed, b)) : html`<div class="empty" style="grid-column:1/-1">No blobs yet. Double-click the canvas to add one.</div>`}
          <div class="ph-layer"><div class="ph"></div></div>
        </div>
      </div>`}
    `;
  }

  ticks(loop) {
    const step = loop <= 4 ? 0.25 : loop <= 12 ? 0.5 : loop <= 30 ? 1 : 2;
    const major = loop <= 4 ? 1 : loop <= 30 ? 1 : 5;
    const out = [];
    for (let i = 0, t = 0; t <= loop + 1e-6; i++, t = i * step) {
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      out.push(html`<div class="tick ${isMajor ? 'major' : ''}" style="left:${(t / loop) * 100}%">${isMajor ? html`<span>${t}s</span>` : nothing}</div>`);
    }
    return out;
  }

  inspector(ed) {
    const keys = [...ed.state.selectedKeys];
    if (!keys.length) return nothing;
    const allEase = keys.every((k) => k.ease);
    const noneEase = keys.every((k) => !k.ease);
    const one = keys.length === 1 ? keys[0] : null;
    const numField = (label, value, step, apply) => html`<label class="lbl">${label}</label>
      <input class="field num" type="number" step=${step} .value=${String(Math.round(value * 100) / 100)} aria-label=${label}
        @change=${(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) apply(v); }}
        @keydown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}>`;
    return html`<div class="insp">
      <span class="lbl">${keys.length === 1 ? '1 key' : `${keys.length} keys`}</span>
      <bl-segmented label="Easing" .options=${[{ value: 'linear', label: 'Linear' }, { value: 'ease', label: 'Ease' }]}
        .value=${allEase ? 'ease' : noneEase ? 'linear' : ''}
        title="Ease: arrive and leave slowly (Easy Ease). Linear: keep moving through the key."
        @bl-change=${(e) => ed.setKeyEase(e.detail === 'ease')}></bl-segmented>
      ${one ? numField('Time', one.t, ed.keyStep, (v) => { ed.retimeKeys(new Map([[one, v]]), 0); ed.commit(); }) : nothing}
      ${one && 'x' in one ? html`
        ${numField('X', one.x, 1, (v) => { ed.setKeyValue(one, { x: v }); ed.commit(); })}
        ${numField('Y', one.y, 1, (v) => { ed.setKeyValue(one, { y: v }); ed.commit(); })}` : nothing}
      ${one && 'v' in one ? numField('Size', one.v, 1, (v) => { ed.setKeyValue(one, { v: clamp(v, 0, 2000) }); ed.commit(); }) : nothing}
      <button class="ib" title="Delete keys (Del)" aria-label="Delete keys" @click=${() => ed.deleteKeys()}>${icon('trash', 15)}</button>
    </div>`;
  }

  blobRows(ed, b) {
    const sel = ed.state.selection.has(b.id);
    const loop = ed.doc.loop;
    // Summary: one marker per distinct key time, standing for all keys there.
    const groups = [];
    for (const tr of ['pos', 'r']) for (const k of b.keys[tr]) {
      const g = groups.find((x) => Math.abs(x.t - k.t) <= KEY_EPS);
      if (g) g.keys.push(k); else groups.push({ t: k.t, keys: [k] });
    }
    return html`
      <div class="lbl-cell blobrow ${sel ? 'sel' : ''}" title="Select this blob (Shift: add to selection)"
        @click=${(e) => ed.selectBlob(b.id, e.shiftKey)}>
        <span class="dot" style="background:${b.color}"></span>
        <span class="name">Blob ${b.id}</span>
      </div>
      <div class="lane-wrap ${sel ? 'sel' : ''}" @pointerdown=${this.onLaneDown}>
        <div class="lane">${groups.map((g) => this.keyEl(ed, g.keys, g.t, loop, true))}</div>
      </div>
      ${sel ? ['pos', 'r'].map((tr) => this.propRow(ed, b, tr)) : nothing}
    `;
  }

  propRow(ed, b, tr) {
    const keys = b.keys[tr];
    const on = keys.length > 0;
    const loop = ed.doc.loop;
    const atNow = on && keyAt(keys, Math.round(ed.state.time / ed.keyStep) * ed.keyStep);
    const first = keys[0], last = keys[keys.length - 1];
    return html`
      <div class="lbl-cell prop ${on ? 'on' : ''}">
        <button class="ib ${on ? 'on' : ''}" aria-pressed=${on}
          title=${on ? `Stop animating ${TRACK_LABEL[tr].toLowerCase()} (removes its keys, keeps the current value)` : `Animate ${TRACK_LABEL[tr].toLowerCase()}: adds a key at the playhead`}
          aria-label="Animate ${TRACK_LABEL[tr]}" @click=${() => ed.toggleTrack(b.id, tr)}>${icon('stopwatch', 15)}</button>
        <span class="name">${TRACK_LABEL[tr]}</span>
        <button class="ib" title="Previous key" aria-label="Previous ${TRACK_LABEL[tr]} key" ?disabled=${!on}
          @click=${() => this.jumpTrack(ed, keys, -1)}>${icon('chevL', 14)}</button>
        <button class="ib key ${atNow ? 'on' : ''}" title=${atNow ? 'Remove the key at the playhead' : 'Add a key at the playhead'}
          aria-label="${atNow ? 'Remove' : 'Add'} ${TRACK_LABEL[tr]} key" @click=${() => ed.toggleKey(b.id, tr)}>${icon('diamond', 14)}</button>
        <button class="ib" title="Next key" aria-label="Next ${TRACK_LABEL[tr]} key" ?disabled=${!on}
          @click=${() => this.jumpTrack(ed, keys, 1)}>${icon('chevR', 14)}</button>
      </div>
      <div class="lane-wrap sel" @pointerdown=${this.onLaneDown}>
        <div class="lane">
          ${keys.length > 1 ? html`<div class="span" style="left:${(clamp(first.t, 0, loop) / loop) * 100}%;width:${((clamp(last.t, 0, loop) - clamp(first.t, 0, loop)) / loop) * 100}%"></div>` : nothing}
          ${keys.map((k) => this.keyEl(ed, [k], k.t, loop, false))}
        </div>
      </div>
    `;
  }

  jumpTrack(ed, keys, dir) {
    const now = ed.state.time;
    const cand = keys.filter((k) => (dir > 0 ? k.t > now + KEY_EPS : k.t < now - KEY_EPS));
    if (!cand.length) return;
    ed.seek(dir > 0 ? cand[0].t : cand[cand.length - 1].t);
  }

  keyEl(ed, keys, t, loop, summary) {
    const selKeys = ed.state.selectedKeys;
    const sel = keys.every((k) => selKeys.has(k));
    const ease = keys.every((k) => k.ease);
    const label = `${summary ? 'Keys' : 'Key'} at ${fmtT(t)}`;
    return html`<button class="k ${summary ? 'sum' : ''} ${ease && !summary ? 'ease' : ''} ${sel ? 'sel' : ''} ${t > loop ? 'out' : ''}"
      style="left:${(clamp(t, 0, loop) / loop) * 100}%" title="${label}${summary ? '' : ` · ${ease ? 'Ease' : 'Linear'} (double-click to switch)`}"
      aria-label=${label} aria-pressed=${sel}
      @pointerdown=${(e) => this.onKeyDown(e, keys)}
      @dblclick=${() => { if (!summary) { ed.selectKeys(keys, false); ed.setKeyEase(!keys[0].ease); } }}></button>`;
  }

  // ---------------------------------------------------------------- pointer
  laneMetrics(el) {
    const lane = el.closest('.lane-wrap, .ruler-wrap')?.querySelector('.lane, .ruler') || this.renderRoot.querySelector('.ruler');
    const r = lane.getBoundingClientRect();
    return { left: r.left, width: Math.max(r.width, 1) };
  }

  timeAt(e, m) {
    const loop = store.editor.doc.loop;
    return clamp(((e.clientX - m.left) / m.width) * loop, 0, loop);
  }

  onRulerDown = (e) => {
    if (e.button !== 0) return;
    const ed = store.editor;
    const target = e.currentTarget;
    const m = this.laneMetrics(target);
    target.setPointerCapture(e.pointerId);
    ed.seek(this.timeAt(e, m));
    const move = (ev) => ed.seek(this.timeAt(ev, m));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  onLaneDown = (e) => {
    // Empty lane space: deselect keys and move the playhead there.
    if (e.button !== 0 || e.target.closest('.k')) return;
    const ed = store.editor;
    ed.clearKeySelection();
    ed.seek(this.timeAt(e, this.laneMetrics(e.currentTarget)));
  };

  onKeyDown(e, keys) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ed = store.editor;
    const selKeys = ed.state.selectedKeys;
    const allSel = keys.every((k) => selKeys.has(k));
    if (e.shiftKey) ed.selectKeys(keys, true);
    else if (!allSel) ed.selectKeys(keys, false);
    const el = e.currentTarget;
    const m = this.laneMetrics(el);
    const loop = ed.doc.loop;
    const orig = new Map([...ed.state.selectedKeys].map((k) => [k, k.t]));
    if (!orig.size) return;
    const startX = e.clientX;
    const anchor = keys[0].t;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const px = ev.clientX - startX;
      if (!moved && Math.abs(px) < 3) return;
      moved = true;
      let dt = (px / m.width) * loop;
      // Snap the grabbed key to the playhead (hold Shift for free movement).
      const ph = ed.state.time;
      if (!ev.shiftKey && Math.abs(anchor + dt - ph) * (m.width / loop) < 6) dt = ph - anchor;
      ed.retimeKeys(orig, dt);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (moved) ed.commit();
      else if (!e.shiftKey) {
        if (allSel && ed.state.selectedKeys.size > keys.length) ed.selectKeys(keys, false);
        ed.seek(keys[0].t);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}

customElements.define('bl-timeline', BlTimeline);
