# Blobs: project context

A browser tool for composing static and animated blob compositions. Circles grow smooth organic bridges when they get close, modelled on the user's reference image of three black circles joined by thin, concave-filleted necks. The tool is plain HTML/CSS/ES modules with **no build step and no dependencies**.

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
| `src/renderer.js` | WebGL2 fragment shader that **mirrors `bridgeDist` + smooth-min from field.js**. Pair data goes in through an RGBA32F texture (4 texels per row). Any change to the bridge SDF or colour blending must be made in **both** places. |
| `src/model.js` | Document schema, `normalizeDoc` (sanitizes all loaded/URL/localStorage input), motion (`resolveBlob`: drift/orbit/swing/pulse, all periodic in `doc.loop` for seamless video), presets (Triad = reference image, Lime orbit, Chain, Cluster, Pulse ring, Blank). |
| `src/scene.js` | `frameAt(doc, time)`: resolves blobs and pairs for a moment in time. |
| `src/contour.js` | Marching squares, RDP simplification, Catmull–Rom to SVG path. |
| `src/export.js` | PNG (offscreen renderer), SVG (CPU field; multi-colour becomes crisp regions), video (MediaRecorder, one loop, real time), download helper. |
| `src/app.js` | Editor UI: pointer/touch/pinch, marquee, resize knob, undo/redo (JSON snapshots), autosave (`localStorage` `blobs:doc:v1`), share links (`#d=` deflate-raw base64url), panel widgets. `window.blobs` is a debug/automation handle. |

## How the bridges work (invariants: don't break)

- For each pair, `t = gap / (reach × avg radius)`. The neck half-width is `thickness·minR·(1−t/snap)²`. Past `snap` it goes negative: the bridge splits and the halves retract. At `t = 1` the remains are pushed ≥ 2.5 units outside the surface (`kill`), so leaving reach leaves no residue.
- Near the snap point the taper exponent blends toward 1.6, so the pinch is localized and never a long hairline.
- Bend and neck offset come from `hash3(idA, idB)` with pairs ordered by id: stable over time and independent of list order.
- Colours blend over `COLOR_BAND = 0.3 × k`, and the colour along a bridge switches near the neck. This avoids muddy junctions.
- **The user's top requirement is smoothness: no flicker, pops, or sudden breaks.** Every quantity must be a continuous function of blob positions and sizes. Tests enforce this by sampling the field (clamped to the visible ±4 band) while blobs move in 0.25–0.5 unit steps.

## No overlap switch (`params.noOverlap`, boolean, default off)

Intended behaviour, per the user: turning it on should remove **only bridges that cross or merge into each other**. Everything else stays exactly as it was.

- `suppressOverlaps()` gives each candidate a suppression amount `sup ∈ [0,1]`. `suppressedT()` maps it onto the bridge's own lifecycle: thin first while still connected, then pinch and retract. So a static frame shows thin bridges, never thorns.
- Clearance between bridges uses **exact segment-to-segment distance** on 9-sample centre-lines. Earlier point sampling missed real crossings.
- **Roots are exempt:** closeness near a shared blob, or near blobs merged with each other (`touching()`), adds a gently fading `rootAllowance`. Without this, ordinary outer edges were stripped (the user reported this bug).
- A real crossing (clearance ≈ −(both half-widths), measured as `cross`) removes **both** bridges unless one is clearly stronger. Brushing side by side moves only the weaker one, where strength = 1 − t. A bridge through a third blob yields unless that blob is merged with one of its ends.
- The regression test "removes only the crossing bridges…" encodes the user's composition across 45 parameter combinations.

## Verification workflow used

- Visual prototyping: render the CPU field to PNG with a tiny Node PNG writer (zlib) and look at it. Fast for tuning shapes.
- Browser checks: `playwright-core` installed in a scratch folder (not a repo dependency) with Chromium from `~/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe`, launched with `--use-angle=swiftshader --enable-unsafe-swiftshader`. Serve the folder with a small Node http server.

## Gotchas already hit

- `.fatal`/`.row` use `display:grid`, which overrides the `hidden` attribute. The global `[hidden]{display:none!important}` in `styles.css` is required.
- MediaRecorder's `start` event can arrive late: the timeline must begin on `onstart`, or the video is empty. Empty output is reported as an error.
- The board auto-fits on resize until the user zooms or pans (`state.autoFit`).
- The user's locale shows decimal commas in number inputs; this is expected.
- Commit as the `gh` user with a noreply email, and end commit messages with the Co-Authored-By line.
