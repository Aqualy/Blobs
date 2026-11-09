// Shared component styles: every control in every component looks the same.
// Colours and sizes come from the tokens on :root in styles.css.
import { css } from './lit.js';

export const base = css`
  :host { box-sizing: border-box; font: 13px/1.4 var(--font); color: var(--text); }
  *, *::before, *::after { box-sizing: inherit; }
  [hidden] { display: none !important; }
  button, input, select { font: inherit; color: inherit; margin: 0; }

  /* ---------- buttons ---------- */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: var(--ctl-h); padding: 0 12px;
    border-radius: var(--r-s); border: 1px solid var(--border-strong);
    background: var(--surface-2); color: var(--text);
    font-size: 12.5px; font-weight: 500; letter-spacing: .005em;
    cursor: pointer; white-space: nowrap; user-select: none;
    transition: background .12s, border-color .12s, color .12s, box-shadow .12s, transform .06s;
  }
  .btn:hover { background: var(--surface-3); border-color: var(--border-hover); }
  .btn:active { transform: translateY(.5px); }
  .btn:disabled { opacity: .35; cursor: default; pointer-events: none; }
  .btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .btn.primary { background: var(--lime); border-color: var(--lime); color: var(--lime-ink); font-weight: 600; }
  .btn.primary:hover { background: var(--lime-hover); border-color: var(--lime-hover); }
  .btn.ghost { background: transparent; border-color: transparent; color: var(--text-2); }
  .btn.ghost:hover { background: var(--surface-2); color: var(--text); }
  .btn.danger:hover {
    color: var(--danger); border-color: color-mix(in srgb, var(--danger) 55%, transparent);
    background: color-mix(in srgb, var(--danger) 9%, var(--surface-2));
  }
  .btn.icon { width: var(--ctl-h); padding: 0; }
  .btn.sm { height: 26px; padding: 0 8px; font-size: 12px; }
  .btn.icon.sm { width: 26px; padding: 0; }
  .btn.link {
    height: auto; padding: 2px 4px; gap: 4px; background: none; border: none;
    color: var(--text-3); font-size: 11.5px; font-weight: 500;
  }
  .btn.link:hover { color: var(--lime); }

  svg.i {
    flex: none; fill: none; stroke: currentColor; stroke-width: 1.75;
    stroke-linecap: round; stroke-linejoin: round;
  }

  /* ---------- text fields and selects ---------- */
  .field {
    height: var(--ctl-h); min-width: 0; padding: 0 8px;
    background: var(--field); border: 1px solid var(--border); border-radius: var(--r-s);
    transition: border-color .12s, background .12s;
  }
  .field:hover { border-color: var(--border-strong); }
  .field:focus { outline: none; border-color: var(--lime); background: var(--field-focus); }
  .num {
    font-family: var(--mono); font-size: 12px; text-align: right;
    font-variant-numeric: tabular-nums; -moz-appearance: textfield; appearance: textfield;
  }
  .num::-webkit-inner-spin-button, .num::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  select.field {
    appearance: none; -webkit-appearance: none; cursor: pointer; padding-right: 26px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239b9ba1' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 9px center;
  }
  select.field option { background: #1c1c1f; color: var(--text); }

  /* ---------- range sliders: thin track, lime fill up to the value ---------- */
  .range {
    -webkit-appearance: none; appearance: none; width: 100%; min-width: 0; height: 20px;
    background: transparent; cursor: pointer; --fill: 0%;
  }
  .range:focus-visible { outline: none; }
  .range::-webkit-slider-runnable-track {
    height: 4px; border-radius: 999px;
    background: linear-gradient(to right, var(--lime) var(--fill), var(--track) var(--fill));
  }
  .range::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border: none; border-radius: 50%;
    background: var(--thumb); box-shadow: 0 0 0 1px rgba(0,0,0,.45), 0 2px 5px rgba(0,0,0,.5);
    transition: transform .12s ease, box-shadow .12s;
  }
  .range:hover::-webkit-slider-thumb { transform: scale(1.12); }
  .range:active::-webkit-slider-thumb { transform: scale(1.2); }
  .range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px color-mix(in srgb, var(--lime) 40%, transparent); }
  .range::-moz-range-track { height: 4px; border-radius: 999px; background: var(--track); }
  .range::-moz-range-progress { height: 4px; border-radius: 999px; background: var(--lime); }
  .range::-moz-range-thumb {
    width: 14px; height: 14px; border: none; border-radius: 50%;
    background: var(--thumb); box-shadow: 0 0 0 1px rgba(0,0,0,.45), 0 2px 5px rgba(0,0,0,.5);
  }

  .muted { color: var(--text-2); }
  .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
`;
