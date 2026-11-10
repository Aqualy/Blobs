// Stroke icons on a 24-unit grid, drawn at 16px by default.
import { html, svg } from './lit.js';

const P = {
  play: svg`<path d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.4-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>`,
  pause: svg`<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>`,
  undo: svg`<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`,
  redo: svg`<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`,
  plus: svg`<path d="M12 5v14M5 12h14"/>`,
  minus: svg`<path d="M5 12h14"/>`,
  x: svg`<path d="M18 6 6 18M6 6l12 12"/>`,
  download: svg`<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>`,
  duplicate: svg`<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>`,
  front: svg`<path d="m12 4 8 4.5-8 4.5-8-4.5z"/><path d="m4 13 8 4.5 8-4.5" opacity=".5"/>`,
  trash: svg`<path d="M4 7h16"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12"/>`,
  file: svg`<path d="M14 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3.5V9h5.5"/><path d="M12 12.5v5M9.5 15h5"/>`,
  folder: svg`<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>`,
  save: svg`<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5"/>`,
  link: svg`<path d="M10 13.5a4.5 4.5 0 0 0 6.8.5l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M14 10.5a4.5 4.5 0 0 0-6.8-.5l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>`,
  fit: svg`<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>`,
  image: svg`<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="9" cy="9" r="1.8"/><path d="m20.5 15-4.8-4.8L6 20"/>`,
  vector: svg`<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M7.5 16.5c1-5 4-8 9-9"/><path d="M4 6h6M18 14v6"/>`,
  video: svg`<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3z"/>`,
  reset: svg`<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>`,
  pointer: svg`<path d="m5 4 13.5 5.5-5.8 1.7-1.7 5.8z"/><path d="m13 13 5.5 5.5"/>`,
  sparkle: svg`<path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15a2 2 0 0 0-1.2-1.2L3.5 12 9 10.2a2 2 0 0 0 1.2-1.2z"/>`,
  check: svg`<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  stopwatch: svg`<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3.5h4M18 7.5l1.2-1.2"/>`,
  diamond: svg`<path d="M12 4.5 19.5 12 12 19.5 4.5 12z"/>`,
  chevL: svg`<path d="m14.5 6-6 6 6 6"/>`,
  chevR: svg`<path d="m9.5 6 6 6-6 6"/>`,
  chevD: svg`<path d="m6 9.5 6 6 6-6"/>`,
  timeline: svg`<path d="M4 6.5h16M4 12h16M4 17.5h16"/><path d="M9 4v16" stroke-width="2.2"/>`,
};

/** @param {keyof typeof P} name */
export const icon = (name, size = 16) =>
  html`<svg class="i" width=${size} height=${size} viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>`;
