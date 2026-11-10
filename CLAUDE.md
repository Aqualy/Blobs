# Blobs: project context

A browser tool for composing static and animated blob compositions. Circles grow smooth organic bridges when they get close, modelled on the user's reference image of three black circles joined by thin, concave-filleted necks. The tool is plain HTML/CSS/ES modules with **no build step and no installed dependencies**. The UI uses Lit web components; Lit is vendored as a single file (`src/vendor/lit-core.min.js`, lit-core 3.2.1) and imported only through `src/ui/lit.js`.

- Repo: https://github.com/Aqualy/Blobs (branch `main`)
- Live: https://blobs-llz4.onrender.com, a Render static site
  - Service `srv-dbotplmc6qcc738o32v0`, workspace "My Workspace" `tea-db5s1fflk1mc73b1s9fg`.
  - The user wants it in the **Blobs project** inside that workspace. The MCP can't assign projects, so this is done in the dashboard.
  - Auto-deploys on push to `main`; Render has GitHub access. Build command is a no-op and the publish path is `./`.
  - The CDN caches HTML for about 5 minutes (`s-maxage=300`).
- Brand colours: `#c5d92f` (lime accent) and `#dddddd` (light grey). Both must stay in the palette (`PALETTE` in `src/model.js`).

## Commands

```sh
npm start   # static server on :5173 (ES modules need http, not file://)
npm test    # node --test "test/*.test.mjs"
```

## Architecture

| File | Role |
| --- | --- |
| `src/field.js` | **Single source of truth for the shape.** `computePairs()` builds bridges; `evalField`/`evalFieldWeights` evaluate the SDF on the CPU. Also holds `DEFAULT_PARAMS`, `PARAM_RANGES`, `LIMITS` (128 blobs / 512 pairs), and no-overlap suppression. |
| `src/renderer.js` | WebGL2 fragment shader that **mirrors `bridgeDist` + smooth-min from field.js**. Pair data goes in through an RGBA32F texture (`COLS` = 5 texels per row; texel 4 holds the bridge handles c0, c1). Any change to the bridge SDF or colour blending must be made in **both** places. Tile culling: `_buildTiles` gives each screen tile its own item list (RG32UI header + R16UI list textures). `skipUnchanged` (editor only) leaves the canvas alone when a frame is identical to the last. |
| `src/model.js` | Document schema, `normalizeDoc` (sanitizes all loaded/URL/localStorage input), motion (`resolveBlob`: drift/orbit/swing/pulse, all periodic in `doc.loop` for seamless video), presets (Triad = reference image, Lime orbit, Chain, Cluster, Pulse ring, Blank). |
| `src/keys.js` | Keyframes. Per blob `keys = { pos: [{t,x,y,ease}], r: [{t,v,ease}], curve }`. A track with keys overrides the static x/y or r (`baseAt`); procedural motion adds on top. Temporal easing is a cubic Hermite per segment (ease key = zero speed). The route is a centripetal Catmull–Rom spline. `normalizeKeys` sanitizes; key times sit on a 0.01 s grid in the editor. |
| `src/scene.js` | `frameAt(doc, time)` returns `{ blobs, pairs, all }`. `blobs` is what gets drawn: size-0 blobs are left out, and blobs with keyframed size below `VANISH_R` sink via `drawnRadius`. `all` holds every blob at its true size in document order, for hit testing and the overlay. |
| `src/contour.js` | Marching squares, RDP simplification, Catmull–Rom to SVG path. |
| `src/export.js` | PNG (offscreen renderer), SVG (CPU field; multi-colour becomes crisp regions), video (MediaRecorder, one loop, real time), download helper. |
| `src/app.js` | Editor core: pointer/touch/pinch, marquee, resize knob, keyboard, undo/redo (JSON snapshots), autosave (`localStorage` `blobs:doc:v1`), share links (`#d=` deflate-raw base64url). Exposes the `editor` API on `store.editor` and calls `notify()` after changes. `window.blobs` is a debug/automation handle; `window.blobs.stats()` gives last-frame timings. |
| `src/ui/timeline.js` | `bl-timeline` (under the stage). It has blob rows, and selected blobs get Position and Size rows with a stopwatch, key navigator and key lanes; a ruler to scrub; an inspector for selected keys. The playhead and clock update through `subscribe('time')` by direct DOM writes, never Lit bindings (writing into a bound node breaks Lit). |
| `src/ui/` | Lit components. `store.js` (editor handle, `notify('change'|'time')`, `StoreController`), `theme.js` (shared control styles; tokens live on `:root` in `styles.css`), `icons.js`, `controls.js` (`bl-slider`, `bl-swatches`, `bl-segmented`, `bl-switch`), `panel.js`, `topbar.js` (+ `bl-zoombar`), `dialogs.js` (`bl-export-dialog`, `bl-toasts`). Controls emit `bl-input` (live preview) and `bl-change` (record an undo step); never use native `input`, which is composed and leaks out of shadow roots. |

## How the bridges work (invariants: don't break)

- For each pair, `t = gap / (reach × avg radius)`. The neck half-width is `thickness·minR·(1−t/snap)²`. Past `snap` it goes negative: the bridge splits and the halves retract. At `t = 1` the remains are pushed ≥ 2.5 units outside the surface (`kill`), so leaving reach leaves no residue.
- Near the snap point the taper exponent blends toward 1.6, so the pinch is localized and never a long hairline.
- Bend and neck offset come from `hash3(idA, idB)` with pairs ordered by id: stable over time and independent of list order.
- Colours blend over `COLOR_BAND = 0.3 × k`, and the colour along a bridge switches near the neck. This avoids muddy junctions.
- **The user's top requirement is smoothness: no flicker, pops, or sudden breaks.** Every quantity must be a continuous function of blob positions and sizes. Tests enforce this by sampling the field (clamped to the visible ±4 band) while blobs move in 0.25–0.5 unit steps.

## Hand-shaped bridges (`doc.bridges`)

- Each edit is `{ a, b, c0, c1, neck, thick, flare, off }` with `a < b` blob ids. Edits at their defaults are dropped, and `normalizeDoc` flips edits given as b→a. `frameAt` passes them to `computePairs(blobs, p, edits)` as a Map keyed `"a-b"` (`bridgeEdits`, cached per array: the editor replaces the array when it adds or removes an edit). Each pair carries `a`, `b`, `c0`, `c1`.
- The centre-line is a cubic Bézier: control points at 1/3 and 2/3 of the segment, offset sideways by (4/3·bend + c0/c1)·L. With c0 = c1 = 0 this is exactly the old parabolic bend, and unedited bridges keep the old straight-bridge code.
- A curved bridge (c0 or c1 ≠ 0) is measured by `curvedDist`. It follows the Bézier as a `CURVE_SEGS` = 48 polyline with a vertex exactly at the neck, and the bridge is the union (hard min) of **round cones** (iq's uneven capsule), each spanning the profile widths at its two ends. This is a true distance. The first version offset the straight bridge sideways and divided by sqrt(1+slope²); with a big flare it folded into spikes (the user reported it). Pieces tried and rejected: per-segment capsules using the projected width left scallops (end caps bulge where width changes fast), and 24 segments left visible facets. Negative radii (retracting bridges): grow both by sh, then add sh back. `bound` covers the polyline hull plus the max width. Tests: "true distance: no folds or spikes" (1-Lipschitz; fails on the old method) and "the bounding circle holds the whole curved bridge".
- `thick` scales the neck (wMid), `flare` scales w0/w1, `neck` replaces the hashed neck position, and `off` sets sup = 1. Every handle branch is skipped when c0 = c1 = 0, and multiplying by 1 is exact, so documents without edits stay bit-identical (checked against the previous commit). The shader mirrors all of it, and a browser check compared GPU and CPU on 128k pixels of strongly edited bridges.
- Editor: `state.bridge = {a, b}`. Hit order is bridge handles → key points → knob → blobs → bridges (and the dashed links of hidden bridges). `Delete` hides the bridge and `Esc` deselects it. Handle drags pause playback.

## Keyframes (invariants)

- Editing a property whose track has keys (drag, knob, `[ ]`, arrows, Radius slider) writes a key at the playhead (`setBasePos`/`setBaseR`), pausing playback first. Without keys it edits the static value. Turning the stopwatch off, or deleting the last key, bakes the current value back into the static x/y/r.
- Blobs that "appear" have keyframed size 0. Only blobs with keyframed size get `grow = true` in `frameAt`. For those, `computePairs` fades bridges through `suppressedT` below `GROW_R = 12`, the split neck is pushed ≥ 2.5 units outside, and `drawnRadius` sinks them below r = 2. Without this a growing blob pops (measured 8 units). Gating on `grow` keeps every non-keyframed composition bit-identical to before: 1,426 frames of old presets plus random scenes were compared.

## Performance invariants (output must stay identical)

- **Tile culling is exact.** A blob is dropped from a tile only if its nearest distance over the tile exceeds the farthest distance of an *earlier* blob plus its k (the running field is never above any earlier item's distance). A bridge is dropped only if its bounding-circle distance exceeds the farthest distance of any blob plus its k. Order is preserved, blob 0 is always kept (the shader's `first` logic), and tiles wholly outside the clipped artboard get no items. Tile size is even, so 2×2 derivative quads never straddle tiles. If lists exceed the texture, rendering falls back to untiled.
- **No overlap pruning is exact.** `bridgeClearance` skips segment pairs whose lower bound (centre distance − half-lengths − widths + per-segment root-allowance lower bound) cannot beat the current best; the pair loop skips pairs whose bounding-circle lower bound is past the end of the overlap ramp.
- Verified by rendering 81 scenes (presets, random up to 128 blobs, No overlap on/off, three zooms) against the previous commit: byte-identical pixels; and 3,315 animated frames of `frameAt` compared bit-for-bit.

## No overlap switch (`params.noOverlap`, boolean, default off)

Intended behaviour, per the user: turning it on should remove **only bridges that cross or merge into each other**. Everything else stays exactly as it was.

- `suppressOverlaps()` gives each candidate a suppression amount `sup ∈ [0,1]`. `suppressedT()` maps it onto the bridge's own lifecycle: thin first while still connected, then pinch and retract. So a static frame shows thin bridges, never thorns.
- Clearance between bridges uses **exact segment-to-segment distance** on 9-sample centre-lines. Earlier point sampling missed real crossings.
- **Roots are exempt:** closeness near a shared blob, or near blobs merged with each other (`touching()`), adds a gently fading `rootAllowance`. Without this, ordinary outer edges were stripped (the user reported this bug).
- A real crossing (clearance ≈ −(both half-widths), measured as `cross`) removes **both** bridges unless one is clearly stronger. Brushing side by side moves only the weaker one, where strength = 1 − t. A bridge through a third blob yields unless that blob is merged with one of its ends.
- The regression test "removes only the crossing bridges…" encodes the user's composition across 45 parameter combinations.

## Max bridges (`params.maxBridges`, 1–12, default 12 = off)

- `limitBridges()` runs after `suppressOverlaps`. Each blob ranks its candidates by strength −gap/reach (plus a tiny `hash3` bias that breaks exact ties). A candidate's suppression is `smoothstep(−W, W, kth − own)`, where `kth` is the cap-th strongest *other* candidate at that blob and W = 0.12. A pair takes the max over its two ends, then goes through `suppressedT` like No overlap.
- One feedback pass lets bridges rejected elsewhere free their slot. The feedback is capped at 2·W because stronger feedback made the transition steep enough to pop (an 8-unit jump in the test).
- Near ties, both bridges are partly suppressed. This is the price of continuity.

## Verification workflow used

- Visual prototyping: render the CPU field to PNG with a tiny Node PNG writer (zlib) and look at it. Fast for tuning shapes.
- Browser checks: `playwright-core` installed in a scratch folder (not a repo dependency) with Chromium from `~/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe`, launched with `--use-angle=swiftshader --enable-unsafe-swiftshader`. Serve the folder with a small Node http server.

## Gotchas already hit

- `.fatal`/`.row` use `display:grid`, which overrides the `hidden` attribute. The global `[hidden]{display:none!important}` in `styles.css` is required.
- MediaRecorder's `start` event can arrive late: the timeline must begin on `onstart`, or the video is empty. Empty output is reported as an error.
- The board auto-fits on resize until the user zooms or pans (`state.autoFit`).
- The user's locale shows decimal commas in number inputs; this is expected.
- Keyboard shortcuts must look through shadow roots for the focused element (`deepActive()` in app.js), or typing in a panel field triggers shortcuts.
- The recording/export renderer must not use `skipUnchanged`: `captureStream` needs every frame drawn.
- Commit as the `gh` user with a noreply email, and end commit messages with the Co-Authored-By line.
