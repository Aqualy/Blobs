// WebGL2 renderer: evaluates the same field as field.js per pixel.
import { LIMITS, blobK, COLOR_BAND, CURVE_SEGS, BULGE_W } from './field.js';

// Data texture: one row per blob (rows 0…maxBlobs-1) and per bridge after
// that, COLS RGBA32F texels per row. Blob rows use texels 0–1; bridge rows
// use all six (texels 4–5: Bézier handles and organic waves, see the shader).
const COLS = 6;
const ROW = COLS * 4;

// Width of the tile-list texture (a power of two: the shader uses shifts).
const LIST_W = 2048;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uData;
uniform highp usampler2D uTiles; // per tile: list offset, blob count | pair count << 16
uniform highp usampler2D uList;  // concatenated per-tile item indices
uniform int uTiled;              // 0 = every pixel visits every item
uniform int uTileSize;           // device px, even so 2x2 derivative quads never straddle tiles
uniform int uBlobCount;
uniform int uPairCount;
uniform float uCanvasH;
uniform float uScale;      // device px per artboard unit
uniform vec2 uOffset;      // device px of artboard origin
uniform vec2 uBoard;       // artboard size in units
uniform vec3 uBg;
uniform vec3 uStage;
uniform float uTransparent; // 1 = transparent background
uniform float uChecker;     // 1 = show checkerboard for transparent bg (editor only)
uniform float uClip;        // 1 = draw stage outside the artboard

out vec4 outColor;

const int PAIR_ROW = ${LIMITS.maxBlobs};

vec4 fetch(int row, int col) { return texelFetch(uData, ivec2(col, row), 0); }
int listAt(int n) { return int(texelFetch(uList, ivec2(n & ${LIST_W - 1}, n >> ${Math.log2(LIST_W)}), 0).r); }

float sminw(float a, float b, float k, out float w) {
  float h = max(k - abs(a - b), 0.0) / k;
  w = clamp(0.5 + 0.5 * (a - b) / (k * ${COLOR_BAND.toFixed(3)}), 0.0, 1.0);
  return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  vec2 p = (frag - uOffset) / uScale;

  float d = 1e9;
  vec3 col = vec3(0.0);
  bool first = true;

  // Tile lists only leave out items this loop would skip at every pixel of
  // the tile anyway, in the same order, so the result is identical.
  int nBlobs = uBlobCount, nPairs = uPairCount, off = 0;
  if (uTiled == 1) {
    uvec2 h = texelFetch(uTiles, ivec2(gl_FragCoord.xy) / uTileSize, 0).xy;
    off = int(h.x);
    nBlobs = int(h.y & 0xffffu);
    nPairs = int(h.y >> 16);
  }

  for (int n = 0; n < ${LIMITS.maxBlobs}; n++) {
    if (n >= nBlobs) break;
    int i = uTiled == 1 ? listAt(off + n) : n;
    vec4 b = fetch(i, 0);
    float di = length(p - b.xy) - b.z;
    float k = b.w;
    if (!first && di > d + k) continue;
    float w;
    d = sminw(d, di, k, w);
    vec3 c = fetch(i, 1).rgb;
    col = first ? c : mix(col, c, w);
    first = false;
  }

  for (int n = 0; n < ${LIMITS.maxPairs}; n++) {
    if (n >= nPairs) break;
    int row = PAIR_ROW + (uTiled == 1 ? listAt(off + nBlobs + n) : n);
    vec4 t3 = fetch(row, 3);   // cx, cy, bound, ib
    float k = fetch(row, 2).y;
    if (length(p - t3.xy) - t3.z > d + k) continue;
    vec4 t0 = fetch(row, 0);   // x0 y0 x1 y1
    vec4 t1 = fetch(row, 1);   // w0 w1 wMid neck
    vec4 t2 = fetch(row, 2);   // bend k taper ia
    vec4 t4 = fetch(row, 4);   // c0 c1 (Bézier handles), bulge, bulgeT (organic knuckle)
    vec4 t5 = fetch(row, 5);   // ripple, bulge2, bulgeT2 (organic), curve (straight → curved fade)
    vec2 ba = t0.zw - t0.xy;
    float L = max(length(ba), 1e-4);
    vec2 u = ba / L;
    vec2 r = p - t0.xy;
    float x = dot(r, u);
    float y = -r.x * u.y + r.y * u.x;
    float m = t1.w;
    float tx;
    float bd;
    bool curved = t4.x != 0.0 || t4.y != 0.0 || t4.z != 0.0 || t5.x != 0.0;
    float dc = 0.0, tc = 0.0;
    if (curved) {
      // Hand-curved bridge: union of round cones along the Bézier
      // centre-line, with a vertex at the neck. Mirrors curvedDist in field.js.
      const int HALF = ${CURVE_SEGS / 2};
      float best = 1e9;
      float bt = 0.0;
      vec2 a = vec2(0.0);
      float ta = 0.0;
      float ra = t1.x; // profile at t = 0: w0 (+ the knuckle's tail)
      if (t4.z != 0.0) {
        float z0 = t4.w / ${BULGE_W}, z1 = t5.z / ${BULGE_W};
        ra += t4.z * exp(-z0 * z0) + t5.y * exp(-z1 * z1);
      }
      for (int s = 1; s <= ${CURVE_SEGS}; s++) {
        float tb = s <= HALF ? m * float(s) / float(HALF) : m + (1.0 - m) * float(s - HALF) / float(HALF);
        float sb = 1.0 - tb;
        // Mirrors centreOffset in field.js.
        float ob = t2.x * 4.0 * tb * (1.0 - tb) + 3.0 * sb * tb * (sb * t4.x + tb * t4.y);
        if (t5.x != 0.0) ob += t5.x * sin(3.0 * 3.14159265358979 * tb);
        vec2 b = vec2(tb * L, ob * L);
        float uu = tb < m ? (m - tb) / m : (tb - m) / (1.0 - m);
        float rb = t1.z + ((tb < m ? t1.x : t1.y) - t1.z) * pow(uu, t2.z);
        if (t4.z != 0.0) {
          float zb = (tb - t4.w) / ${BULGE_W}, zc = (tb - t5.z) / ${BULGE_W};
          rb += t4.z * exp(-zb * zb) + t5.y * exp(-zc * zc);
        }
        // Round cone a→b with radii ra, rb (iq's uneven capsule).
        float sh = max(0.0, -min(ra, rb));
        float r0 = ra + sh, r1 = rb + sh;
        vec2 pb = b - a;
        vec2 pp = vec2(x, y) - a;
        float hh = dot(pb, pb);
        float qy = dot(pp, pb) / hh;
        float qx = abs(pp.x * pb.y - pp.y * pb.x) / hh;
        float bb = r0 - r1;
        float dd;
        if (bb * bb >= hh) {
          dd = min(length(pp) - r0, length(pp - pb) - r1);
        } else {
          float cx = sqrt(hh - bb * bb);
          float kk = cx * qy - bb * qx;
          if (kk < 0.0) dd = sqrt(hh * (qx * qx + qy * qy)) - r0;
          else if (kk > cx) dd = sqrt(hh * (qx * qx + qy * qy + 1.0 - 2.0 * qy)) - r1;
          else dd = cx * qx + bb * qy - r0;
        }
        dd += sh;
        if (dd < best) { best = dd; bt = ta + (tb - ta) * clamp(qy, 0.0, 1.0); }
        a = b;
        ta = tb;
        ra = rb;
      }
      dc = best;
      tc = bt;
    }
    if (curved && t5.w >= 1.0) {
      bd = dc;
      tx = tc;
    } else {
      // Mirrors straightDist in field.js.
      tx = clamp(x / L, 0.0, 1.0);
      y -= t2.x * L * 4.0 * tx * (1.0 - tx);
      float uu = tx < m ? (m - tx) / m : (tx - m) / (1.0 - m);
      float wEnd = tx < m ? t1.x : t1.y;
      float rad = t1.z + (wEnd - t1.z) * pow(uu, t2.z);
      bd = length(vec2(x - tx * L, y)) - rad;
      if (curved) {
        bd = bd + (dc - bd) * t5.w;
        if (t5.w > 0.5) tx = tc;
      }
    }
    float w;
    d = sminw(d, bd, k, w);
    vec3 ca = fetch(int(t2.w), 1).rgb;
    vec3 cb = fetch(int(t3.w), 1).rgb;
    col = mix(col, mix(ca, cb, smoothstep(m - 0.2, m + 0.2, tx)), w);
  }

  // Anti-aliasing from the actual screen-space gradient of the field.
  float g = length(vec2(dFdx(d), dFdy(d)));
  g = clamp(g, 0.25 / uScale, 4.0 / uScale);
  float cov = clamp(0.5 - d / g, 0.0, 1.0);

  // Artboard mask (crisp, pixel aligned).
  vec2 q = min(p, uBoard - p) * uScale;
  float inBoard = clamp(min(q.x, q.y) + 0.5, 0.0, 1.0);
  if (uClip < 0.5) inBoard = 1.0;
  cov *= inBoard;

  vec3 bg = uBg;
  float bgA = 1.0 - uTransparent;
  if (uTransparent > 0.5 && uChecker > 0.5) {
    vec2 cell = floor(frag / 10.0);
    float ck = mod(cell.x + cell.y, 2.0);
    bg = mix(vec3(0.86), vec3(0.74), ck);
    bgA = 1.0;
  }
  // Composite blob over background (straight alpha output).
  float a = cov + bgA * (1.0 - cov);
  vec3 rgb = a > 0.0 ? (col * cov + bg * bgA * (1.0 - cov)) / a : vec3(0.0);
  vec4 board = vec4(rgb, a);
  outColor = mix(vec4(uStage, uClip > 0.5 ? 1.0 : 0.0), board, inBoard);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('Shader compile failed: ' + log);
  }
  return s;
}

export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const UNIFORMS = ['uData', 'uTiles', 'uList', 'uTiled', 'uTileSize', 'uBlobCount', 'uPairCount', 'uCanvasH', 'uScale', 'uOffset', 'uBoard', 'uBg', 'uStage', 'uTransparent', 'uChecker', 'uClip'];

/** Aim for about this many tiles: enough to cull well, few enough to build fast. */
const TARGET_TILES = 2400;

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{preserve?: boolean, skipUnchanged?: boolean}} [opts]
   *   skipUnchanged: leave the canvas as it is when a frame is identical to the
   *   last one drawn (editor only: recording needs every frame drawn).
   */
  constructor(canvas, { preserve = false, skipUnchanged = false } = {}) {
    this.canvas = canvas;
    this.skipUnchanged = skipUnchanged;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: preserve,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.lost = false;
    /** Set false to make every pixel visit every item (for comparisons). */
    this.tiling = true;
    /** Counts and timings of the last frame, for profiling. */
    this.stats = { drawn: false, tiles: 0, listLength: 0, tileMs: 0 };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this._init(); });
    this._init();
  }

  _init() {
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Shader link failed: ' + gl.getProgramInfoLog(prog));
    }
    this.prog = prog;
    this.u = {};
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(prog, name);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    this.rows = LIMITS.maxBlobs + LIMITS.maxPairs;
    this.data = new Float32Array(this.rows * ROW);
    this.tex = this._texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, COLS, this.rows, 0, gl.RGBA, gl.FLOAT, this.data);

    this.tileTex = this._texture();
    this.tileDims = [0, 0];
    this.tileSize = 16;
    this.listTex = this._texture();
    this.listRows = 0;
    this.maxListRows = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096);
    this.list = new Uint16Array(LIST_W * 16);
    this.header = new Uint32Array(0);
    this.last = null; // the last drawn frame, for skipUnchanged
  }

  _texture() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /**
   * Builds the per-tile item lists. An item is left out of a tile only when
   * the shader's own early-out would skip it at every pixel of that tile:
   *  - blob i: its nearest distance over the tile exceeds the farthest
   *    distance of some earlier blob plus its fillet k (the running field
   *    value is never above any earlier blob's distance);
   *  - bridge: its bounding-circle distance exceeds the farthest distance of
   *    any blob plus its k.
   * Order is kept, so every pixel does exactly the same arithmetic as
   * without tiles. Tiles wholly outside a clipped artboard get no items:
   * those pixels show the stage colour whatever the field is.
   * Returns the list length, or -1 when the lists would not fit.
   */
  _buildTiles(nb, np, view, board, W, H, clip) {
    const T = Math.max(16, 2 * Math.ceil(Math.sqrt((W * H) / TARGET_TILES) / 2));
    const cols = Math.ceil(W / T), rows = Math.ceil(H / T);
    const D = this.data;
    const s = view.scale, ox = view.ox, oy = view.oy;
    const pad = 1 / s; // one device pixel of slack around each tile
    const base = LIMITS.maxBlobs * ROW;
    if (this.header.length < cols * rows * 2) this.header = new Uint32Array(cols * rows * 2);
    const header = this.header;
    const cap = LIST_W * this.maxListRows;
    let list = this.list;
    let len = 0;
    const outX0 = -0.5 / s, outX1 = board.w + 0.5 / s, outY0 = -0.5 / s, outY1 = board.h + 0.5 / s;

    for (let ty = 0; ty < rows; ty++) {
      // Tile rows follow gl_FragCoord (bottom-up); frag y is top-down.
      const y0 = (H - (ty + 1) * T - oy) / s - pad;
      const y1 = (H - ty * T - oy) / s + pad;
      for (let tx = 0; tx < cols; tx++) {
        const x0 = (tx * T - ox) / s - pad;
        const x1 = ((tx + 1) * T - ox) / s + pad;
        const h = (ty * cols + tx) * 2;
        header[h] = len;
        if (clip && (x1 < outX0 || x0 > outX1 || y1 < outY0 || y0 > outY1)) { header[h + 1] = 0; continue; }
        if (len + nb + np > cap) return -1; // would not fit the texture: draw untiled
        if (len + nb + np > list.length) {
          const grown = new Uint16Array(Math.min(cap, Math.max(list.length * 2, len + nb + np)));
          grown.set(list.subarray(0, len));
          list = this.list = grown;
        }
        let ub = Infinity, kb = 0;
        for (let i = 0; i < nb; i++) {
          const o = i * ROW;
          const bx = D[o], by = D[o + 1], r = D[o + 2], k = D[o + 3];
          const ex = bx < x0 ? x0 - bx : bx > x1 ? bx - x1 : 0;
          const ey = by < y0 ? y0 - by : by > y1 ? by - y1 : 0;
          const lb = Math.sqrt(ex * ex + ey * ey) - r;
          if (i === 0 || lb <= ub + k + tol(lb, ub, k)) { list[len++] = i; kb++; }
          const fx = Math.max(Math.abs(bx - x0), Math.abs(bx - x1));
          const fy = Math.max(Math.abs(by - y0), Math.abs(by - y1));
          const far = Math.sqrt(fx * fx + fy * fy) - r;
          if (far < ub) ub = far;
        }
        let kp = 0;
        for (let j = 0; j < np; j++) {
          const o = base + j * ROW;
          const cx = D[o + 12], cy = D[o + 13], bound = D[o + 14], k = D[o + 9];
          const ex = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
          const ey = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
          const lb = Math.sqrt(ex * ex + ey * ey) - bound;
          if (lb <= ub + k + tol(lb, ub, k)) { list[len++] = j; kp++; }
        }
        header[h + 1] = kb | (kp << 16);
      }
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    if (this.tileDims[0] !== cols || this.tileDims[1] !== rows) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, cols, rows, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, header, 0);
      this.tileDims = [cols, rows];
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RG_INTEGER, gl.UNSIGNED_INT, header, 0);
    }
    const usedRows = Math.max(1, Math.ceil(len / LIST_W));
    if (list.length < usedRows * LIST_W) {
      const grown = new Uint16Array(usedRows * LIST_W);
      grown.set(list.subarray(0, len));
      list = this.list = grown;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.listTex);
    if (usedRows > this.listRows) {
      this.listRows = Math.min(this.maxListRows, Math.max(usedRows, this.listRows * 2, 16));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, LIST_W, this.listRows, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, null);
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LIST_W, usedRows, gl.RED_INTEGER, gl.UNSIGNED_SHORT, list, 0);
    this.stats.tiles = cols * rows;
    this.tileSize = T;
    return len;
  }

  /**
   * @param {object} frame
   * @param {{x,y,r,rgb}[]} frame.blobs
   * @param {object[]} frame.pairs from computePairs
   * @param {object} frame.params
   * @param {{scale:number, ox:number, oy:number}} frame.view device-pixel transform
   * @param {{w:number,h:number}} frame.board
   * @returns {boolean} whether anything was drawn
   */
  render(frame) {
    if (this.lost) return false;
    const gl = this.gl;
    const { blobs, pairs, params, view, board } = frame;
    const nb = Math.min(blobs.length, LIMITS.maxBlobs);
    const np = Math.min(pairs.length, LIMITS.maxPairs);
    const D = this.data;

    for (let i = 0; i < nb; i++) {
      const b = blobs[i];
      const o = i * ROW;
      D[o] = b.x; D[o + 1] = b.y; D[o + 2] = b.r; D[o + 3] = blobK(b.r, params);
      D[o + 4] = b.rgb[0]; D[o + 5] = b.rgb[1]; D[o + 6] = b.rgb[2]; D[o + 7] = 1;
    }
    const base = LIMITS.maxBlobs * ROW;
    for (let j = 0; j < np; j++) {
      const p = pairs[j];
      const o = base + j * ROW;
      D[o] = p.x0; D[o + 1] = p.y0; D[o + 2] = p.x1; D[o + 3] = p.y1;
      D[o + 4] = p.w0; D[o + 5] = p.w1; D[o + 6] = p.wMid; D[o + 7] = p.neck;
      D[o + 8] = p.bend; D[o + 9] = p.k; D[o + 10] = p.taper; D[o + 11] = p.ia;
      D[o + 12] = p.cx; D[o + 13] = p.cy; D[o + 14] = p.bound; D[o + 15] = p.ib;
      D[o + 16] = p.c0 || 0; D[o + 17] = p.c1 || 0; D[o + 18] = p.bulge || 0; D[o + 19] = p.bulgeT || 0;
      D[o + 20] = p.ripple || 0; D[o + 21] = p.bulge2 || 0; D[o + 22] = p.bulgeT2 || 0; D[o + 23] = p.curve || 0;
    }

    const W = this.canvas.width, H = this.canvas.height;
    const bg = hexToRgb(frame.background);
    const st = hexToRgb(frame.stage || '#0f0f10');
    const clip = frame.clip !== false;
    const sig = [W, H, nb, np, view.scale, view.ox, view.oy, board.w, board.h, ...bg, ...st,
      frame.transparent ? 1 : 0, frame.checker ? 1 : 0, clip ? 1 : 0, this.tiling ? 1 : 0];
    if (this.skipUnchanged && this.last && sameFrame(this.last, sig, D, nb, np)) {
      this.stats.drawn = false;
      return false;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (nb > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, COLS, nb, gl.RGBA, gl.FLOAT, D, 0);
    if (np > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, LIMITS.maxBlobs, COLS, np, gl.RGBA, gl.FLOAT, D, base);

    const t0 = performance.now();
    const len = this.tiling ? this._buildTiles(nb, np, view, board, W, H, clip) : -1;
    this.stats.tileMs = performance.now() - t0;
    this.stats.listLength = Math.max(len, 0);
    const tiled = len >= 0;

    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.listTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uData, 0);
    gl.uniform1i(this.u.uTiles, 1);
    gl.uniform1i(this.u.uList, 2);
    gl.uniform1i(this.u.uTiled, tiled ? 1 : 0);
    gl.uniform1i(this.u.uTileSize, tiled ? this.tileSize : 1);
    gl.uniform1i(this.u.uBlobCount, nb);
    gl.uniform1i(this.u.uPairCount, np);
    gl.uniform1f(this.u.uCanvasH, H);
    gl.uniform1f(this.u.uScale, view.scale);
    gl.uniform2f(this.u.uOffset, view.ox, view.oy);
    gl.uniform2f(this.u.uBoard, board.w, board.h);
    gl.uniform3f(this.u.uBg, bg[0], bg[1], bg[2]);
    gl.uniform3f(this.u.uStage, st[0], st[1], st[2]);
    gl.uniform1f(this.u.uTransparent, frame.transparent ? 1 : 0);
    gl.uniform1f(this.u.uChecker, frame.checker ? 1 : 0);
    gl.uniform1f(this.u.uClip, clip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (this.skipUnchanged) this.last = remember(this.last, sig, D);
    this.stats.drawn = true;
    return true;
  }

  /** Forget the last frame, so the next render always draws. */
  invalidate() { this.last = null; }
}

/** Float32 slack for the culling comparisons (culling less is always safe). */
function tol(a, b, k) {
  return 1e-3 + 2e-5 * (Math.abs(a) + (b === Infinity ? 0 : Math.abs(b)) + k);
}

function sameFrame(last, sig, D, nb, np) {
  if (last.sig.length !== sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (last.sig[i] !== sig[i]) return false;
  const base = LIMITS.maxBlobs * ROW;
  for (let i = 0, n = nb * ROW; i < n; i++) if (last.data[i] !== D[i]) return false;
  for (let i = base, n = base + np * ROW; i < n; i++) if (last.data[i] !== D[i]) return false;
  return true;
}

function remember(last, sig, D) {
  const data = last?.data || new Float32Array(D.length);
  data.set(D);
  return { sig, data };
}
