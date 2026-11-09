// Reusable form controls. Each reports edits with two events:
//   bl-input  (detail = value) while the value is changing: preview it
//   bl-change (detail = value) when the edit is done: record an undo step
import { LitElement, html, css } from './lit.js';
import { base } from './theme.js';
import { emit } from './store.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

function fmt(v, step) {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return Number(v).toFixed(dec);
}

/** Label, range slider and number field bound together. */
export class BlSlider extends LitElement {
  static properties = {
    label: {},
    value: { type: Number },
    min: { type: Number },
    max: { type: Number },
    step: { type: Number },
    numMax: { type: Number, attribute: 'num-max' },
  };

  static styles = [base, css`
    :host { display: grid; grid-template-columns: 84px minmax(0, 1fr) 58px; align-items: center; gap: 10px; min-height: 32px; }
    label { color: var(--text-2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
    .field { height: 26px; padding: 0 7px; width: 100%; }
  `];

  constructor() {
    super();
    this.min = 0; this.max = 1; this.step = 0.01; this.value = 0;
  }

  render() {
    const v = Number.isFinite(this.value) ? this.value : this.min;
    const pct = clamp((v - this.min) / (this.max - this.min || 1), 0, 1) * 100;
    return html`
      <label for="range">${this.label}</label>
      <input id="range" class="range" type="range" min=${this.min} max=${this.max} step=${this.step}
        .value=${String(v)} style="--fill:${pct}%" aria-label=${this.label}
        @input=${(e) => this.apply(parseFloat(e.target.value))}
        @change=${() => emit(this, 'bl-change', this.value)}>
      <input id="num" class="field num" type="number" min=${this.min} max=${this.numMax ?? this.max}
        step=${this.step} aria-label=${this.label}
        @input=${(e) => { if (e.target.value !== '') this.apply(parseFloat(e.target.value)); }}
        @change=${this.onNumberChange}
        @keydown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}>
    `;
  }

  updated() {
    // Never rewrite the number field while someone is typing in it.
    const num = this.renderRoot.getElementById('num');
    if (this.renderRoot.activeElement !== num) num.value = fmt(this.value ?? this.min, this.step);
  }

  apply(v) {
    if (!Number.isFinite(v)) return;
    v = clamp(v, this.min, this.numMax ?? this.max);
    this.value = v;
    emit(this, 'bl-input', v);
  }

  onNumberChange(e) {
    this.apply(parseFloat(e.target.value));
    e.target.value = fmt(this.value, this.step);
    emit(this, 'bl-change', this.value);
  }
}

/** Palette swatches, a custom colour picker and a hex field. */
export class BlSwatches extends LitElement {
  static properties = { value: {}, palette: { type: Array }, label: {} };

  static styles = [base, css`
    :host { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
    .sw {
      position: relative; width: 22px; height: 22px; padding: 0; border-radius: 50%; cursor: pointer;
      border: 1px solid rgba(255,255,255,.14); box-shadow: inset 0 0 0 1px rgba(0,0,0,.25);
      transition: transform .12s, box-shadow .12s;
    }
    .sw:hover { transform: scale(1.1); }
    .sw:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .sw.on { box-shadow: 0 0 0 2px var(--surface-1), 0 0 0 3.5px var(--lime); }
    .custom { overflow: hidden; background: conic-gradient(#ff5b5b, #ffd23f, #c5d92f, #3fd2ff, #9d5bff, #ff5b5b); }
    .custom input { position: absolute; inset: -8px; width: 40px; height: 40px; opacity: 0; cursor: pointer; }
    .hex { width: 78px; height: 26px; padding: 0 7px; font-family: var(--mono); font-size: 12px; text-transform: lowercase; }
  `];

  constructor() { super(); this.palette = []; this.value = '#000000'; this.label = 'Color'; }

  render() {
    const v = this.value || '#000000';
    const custom = !this.palette.includes(v);
    return html`
      ${this.palette.map((c) => html`
        <button type="button" class="sw ${c === v ? 'on' : ''}" style="background:${c}" title=${c}
          aria-label="${this.label} ${c}" aria-pressed=${c === v} @click=${() => emit(this, 'bl-change', c)}></button>`)}
      <label class="sw custom ${custom ? 'on' : ''}" title="Custom colour">
        <input type="color" .value=${v} aria-label="Custom ${this.label.toLowerCase()}"
          @input=${(e) => emit(this, 'bl-input', e.target.value.toLowerCase())}
          @change=${(e) => emit(this, 'bl-change', e.target.value.toLowerCase())}>
      </label>
      <input id="hex" class="field hex" type="text" maxlength="7" spellcheck="false" aria-label="${this.label} hex"
        @change=${this.onHex} @keydown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}>
    `;
  }

  updated() {
    const hex = this.renderRoot.getElementById('hex');
    if (this.renderRoot.activeElement !== hex) hex.value = this.value || '';
  }

  onHex(e) {
    let v = e.target.value.trim().toLowerCase();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
    if (/^#[0-9a-f]{6}$/.test(v)) emit(this, 'bl-change', v);
    e.target.value = /^#[0-9a-f]{6}$/.test(v) ? v : this.value;
  }
}

/** One-of-many choice drawn as a segmented pill. */
export class BlSegmented extends LitElement {
  static properties = { options: { type: Array }, value: {}, label: {} };

  static styles = [base, css`
    :host { display: flex; padding: 2px; gap: 2px; background: var(--field); border: 1px solid var(--border); border-radius: 8px; }
    button {
      flex: 1 1 0; min-width: 0; height: 24px; padding: 0 8px; border: none; border-radius: 6px;
      background: transparent; color: var(--text-2); font-size: 12px; font-weight: 500; cursor: pointer;
      transition: background .12s, color .12s;
    }
    button:hover { color: var(--text); background: var(--surface-2); }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: -1px; }
    button.on { background: var(--surface-3); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.05); }
  `];

  constructor() { super(); this.options = []; }

  render() {
    return html`<div role="radiogroup" aria-label=${this.label || ''} style="display:contents" @keydown=${this.onKey}>
      ${this.options.map((o) => {
        const on = String(o.value) === String(this.value);
        return html`<button type="button" role="radio" class=${on ? 'on' : ''} aria-checked=${on}
          tabindex=${on ? 0 : -1} @click=${() => this.pick(o.value)}>${o.label}</button>`;
      })}
    </div>`;
  }

  pick(v) {
    if (String(v) !== String(this.value)) emit(this, 'bl-change', v);
  }

  onKey(e) {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation(); // arrows must not nudge the selected blobs
    const i = this.options.findIndex((o) => String(o.value) === String(this.value));
    const next = this.options[(i + dir + this.options.length) % this.options.length];
    this.pick(next.value);
    this.updateComplete.then(() => this.renderRoot.querySelector('button.on')?.focus());
  }
}

/** On/off switch with a label and an optional description. */
export class BlSwitch extends LitElement {
  static properties = { checked: { type: Boolean }, label: {}, description: {} };

  static styles = [base, css`
    :host { display: block; }
    button {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 12px;
      width: 100%; padding: 6px 0; background: none; border: none; text-align: left; cursor: pointer;
    }
    button:focus-visible { outline: none; }
    button:focus-visible .track { box-shadow: 0 0 0 2px var(--surface-1), 0 0 0 4px var(--focus); }
    .label { font-size: 12.5px; color: var(--text); }
    .desc { grid-column: 1; font-size: 11.5px; color: var(--text-3); }
    .track {
      grid-row: 1 / span 2; grid-column: 2; position: relative; width: 32px; height: 18px; border-radius: 999px;
      background: var(--track); transition: background .15s;
    }
    .track::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
      background: var(--thumb); box-shadow: 0 1px 3px rgba(0,0,0,.4); transition: transform .15s ease;
    }
    [aria-checked="true"] .track { background: var(--lime); }
    [aria-checked="true"] .track::after { transform: translateX(14px); background: var(--lime-ink); }
  `];

  render() {
    return html`<button type="button" role="switch" aria-checked=${!!this.checked}
      @click=${() => emit(this, 'bl-change', !this.checked)}>
      <span class="label">${this.label}</span>
      <span class="track"></span>
      ${this.description ? html`<span class="desc">${this.description}</span>` : ''}
    </button>`;
  }
}

customElements.define('bl-slider', BlSlider);
customElements.define('bl-swatches', BlSwatches);
customElements.define('bl-segmented', BlSegmented);
customElements.define('bl-switch', BlSwitch);
