# Blobs

A browser tool for composing **static and animated blob compositions** in which circles grow smooth, organic bridges toward each other when they get close: thick goo when they touch, long thin threads as they move apart, then a clean pinch-off and retraction.

Plain HTML/CSS/JS with no build step. The interface is built with [Lit](https://lit.dev) web components; Lit is vendored as one file in `src/vendor/`, so there is nothing to install. It runs on any static host, GitHub Pages included.

## Features

- **Organic bridges.** Every pair of blobs within reach is joined by a tapered, slightly bent neck, and a cubic smooth-min fillets it into both blobs. Bridge width, the pinch, and the retraction are all continuous functions of distance and size, so bridges never flicker, pop, or break suddenly. The test suite checks this.
- **GPU rendering.** A WebGL2 signed-distance-field shader handles up to 128 blobs and 512 bridges, with anti-aliasing taken from the field's real screen-space gradient. The screen is split into tiles and each tile only visits the blobs and bridges that can affect it, so large compositions stay fast.
- **Dynamic compositions.** Each blob can drift, orbit, swing, and pulse. All motion repeats exactly over the loop length, so recorded videos loop seamlessly.
- **Keyframe animation.** A timeline under the canvas works like After Effects. Click a property's stopwatch (Position or Size) to animate it; after that, moving or resizing the blob sets a key at the playhead. Routes run as smooth curves through the position keys (or as straight lines), and each key is linear or eased. Keyframe the size to 0 to make a blob appear or vanish: its bridges reach out and retract smoothly instead of popping. Keyframes and the procedural motions combine. The **Appear (keyframes)** preset shows three orbs growing in along their own routes.
- **Colour blending.** Blobs of different colours blend cleanly through their bridges. The palette includes `#c5d92f` and `#dddddd`.
- **Bridge controls.** Sliders set reach, snap point, thickness, flare, taper, smoothness, and organic variation.
- **No overlap switch.** When it is on, bridges that cross are removed (both of them, unless one is clearly stronger), and a bridge that brushes against another bridge or runs through a third blob gives way. Bridges meeting at a shared blob are left alone, so the rest of the composition stays exactly as it was. Removed bridges thin out and pinch off; they never pop.
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
| Add a blob | Double-click the canvas, press `A`, or click **Add blob** |
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
| Animate a property | Select a blob, click the stopwatch next to Position or Size in the timeline, move the playhead, then edit the blob |
| Keyframes | Click to select (`Shift` adds), drag to retime (snaps to the playhead; `Shift` = free), double-click to switch Linear/Ease, `Delete` removes. Drag the square route points on the canvas to reshape the path |
| Previous / next key | `J` / `L`, or the arrows beside each property |

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
4. With **No overlap** on, each bridge is sampled along its length with its real width. A bridge that comes close to another bridge or a third blob gets a smooth suppression amount, and the weaker of two bridges yields. Suppression first thins a bridge, then pinches and retracts it, so a composition that settles mid-way shows a thin bridge rather than a sudden gap.
5. Circles and bridges are merged with a cubic smooth-min. Colours blend over a narrower band than the shape, which keeps colour junctions clean.
6. For speed, the renderer builds a list of items per screen tile. An item is left out of a tile only when the shader would skip it at every pixel of that tile anyway, so tiled and untiled output are identical. `window.blobs.stats()` in the browser console reports the last frame's timings.

## Browser support

Current Chrome, Edge, Firefox, and Safari (WebGL2 is required). Video recording uses `MediaRecorder`. Chrome, Edge, and Firefox record WebM; Safari records MP4.
