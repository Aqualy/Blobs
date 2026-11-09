# Blobs

A browser tool for composing **static and animated blob compositions** in which circles grow smooth, organic bridges toward each other when they get close: thick goo when they touch, long thin threads as they move apart, then a clean pinch-off and retraction.

Plain HTML/CSS/JS with no build step and no dependencies. It runs on any static host, GitHub Pages included.

## Features

- **Organic bridges.** Every pair of blobs within reach is joined by a tapered, slightly bent neck, and a cubic smooth-min fillets it into both blobs. Bridge width, the pinch, and the retraction are all continuous functions of distance and size, so bridges never flicker, pop, or break suddenly. The test suite checks this.
- **GPU rendering.** A WebGL2 signed-distance-field shader handles up to 128 blobs and 512 bridges, with anti-aliasing taken from the field's real screen-space gradient.
- **Dynamic compositions.** Each blob can drift, orbit, swing, and pulse. All motion repeats exactly over the loop length, so recorded videos loop seamlessly.
- **Colour blending.** Blobs of different colours blend cleanly through their bridges. The palette includes `#c5d92f` and `#dddddd`.
- **Bridge controls.** Sliders set reach, snap point, thickness, flare, taper, smoothness, and organic variation.
- **Export options.**
  - PNG at 1×, 2×, or 4×, with an optional transparent background.
  - SVG as true vector outlines (marching squares plus Catmull–Rom curves). Multi-colour compositions become crisp colour regions.
  - Video: one seamless loop in WebM or MP4, depending on the browser.
  - JSON: save and open compositions.
- **Share links.** A compressed copy of the composition is stored in the URL.
- **Editor basics.** Autosave, undo/redo, multi-select, marquee selection, zoom/pan, touch and pinch, and canvas size presets.

## Using it

| Action | How |
| --- | --- |
| Add a blob | Double-click the canvas, press `A`, or click **+ Blob** |
| Move | Drag a blob (hold `Shift` to lock the axis, `Alt` to duplicate while dragging) |
| Resize | Drag the knob on the selection ring, or press `[` / `]` |
| Select several | `Shift`-click, drag a box, or press `Ctrl+A` |
| Nudge | Arrow keys (`Shift` = 10 units) |
| Duplicate / delete | `Ctrl+D` / `Delete` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` |
| Play / pause | Tap `Space` or press `K` |
| Pan | Hold `Space` and drag, or drag with the middle or right mouse button, or two-finger scroll |
| Zoom | Mouse wheel or pinch, or `+` / `-`; `F` fits the canvas to the screen |
| Save JSON | `Ctrl+S` |

## Running locally

ES modules must be served over HTTP, so opening `index.html` directly from disk won't work:

```sh
npm start          # serves the folder on http://localhost:5173
# or: python -m http.server 5173
```

Run the tests (Node 18+):

```sh
npm test
```

The tests check that the field stays continuous while blobs merge, stretch, pinch, and separate, and while they grow. They also check that a bridge leaving reach leaves no residue, that every motion loops seamlessly, that documents are sanitized, and that contour extraction and SVG export are accurate.

## How it works

`src/field.js` defines the shape, and the GPU shader (`src/renderer.js`) and the CPU code (SVG export, tests) share it.

1. For every pair of blobs, the gap is normalized by their reach: `t = gap / (reach × avg radius)`.
2. The neck half-width is `thickness × (1 − t/snap)²`. Approaching the snap point, the profile narrows into a localized pinch. Past it the neck turns negative: the bridge splits and the two halves retract into their blobs, reaching zero just as the pair leaves reach.
3. Each bridge is a bent capsule whose radius follows `wMid + (wEnd − wMid)·|u|^taper` along its length. A per-pair seeded hash sets its bend and neck offset, which keeps them stable over time and independent of blob order.
4. Circles and bridges are merged with a cubic smooth-min. Colours blend over a narrower band than the shape, which keeps colour junctions clean.

## Browser support

Current Chrome, Edge, Firefox, and Safari (WebGL2 is required). Video recording uses `MediaRecorder`. Chrome, Edge, and Firefox record WebM; Safari records MP4.
