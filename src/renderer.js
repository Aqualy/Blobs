// WebGL2 renderer: evaluates the same field as field.js per pixel.
import { LIMITS, blobK, COLOR_BAND } from './field.js';

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uData;
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

  for (int i = 0; i < ${LIMITS.maxBlobs}; i++) {
    if (i >= uBlobCount) break;
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

  for (int j = 0; j < ${LIMITS.maxPairs}; j++) {
    if (j >= uPairCount) break;
    int row = PAIR_ROW + j;
    vec4 t3 = fetch(row, 3);   // cx, cy, bound, ib
    float k = fetch(row, 2).y;
    if (length(p - t3.xy) - t3.z > d + k) continue;
    vec4 t0 = fetch(row, 0);   // x0 y0 x1 y1
    vec4 t1 = fetch(row, 1);   // w0 w1 wMid neck
    vec4 t2 = fetch(row, 2);   // bend k taper ia
    vec2 ba = t0.zw - t0.xy;
    float L = max(length(ba), 1e-4);
    vec2 u = ba / L;
    vec2 r = p - t0.xy;
    float x = dot(r, u);
    float y = -r.x * u.y + r.y * u.x;
    float tx = clamp(x / L, 0.0, 1.0);
    y -= t2.x * L * 4.0 * tx * (1.0 - tx);
    float m = t1.w;
    float uu = tx < m ? (m - tx) / m : (tx - m) / (1.0 - m);
    float wEnd = tx < m ? t1.x : t1.y;
    float rad = t1.z + (wEnd - t1.z) * pow(uu, t2.z);
    float bd = length(vec2(x - tx * L, y)) - rad;
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


export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, { preserve = false } = {}) {
    this.canvas = canvas;
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
    for (const name of ['uData', 'uBlobCount', 'uPairCount', 'uCanvasH', 'uScale', 'uOffset', 'uBoard', 'uBg', 'uStage', 'uTransparent', 'uChecker', 'uClip']) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    this.rows = LIMITS.maxBlobs + LIMITS.maxPairs;
    this.data = new Float32Array(this.rows * 4 * 4);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, this.rows, 0, gl.RGBA, gl.FLOAT, this.data);
    this.tex = tex;
  }

  /**
   * @param {object} frame
   * @param {{x,y,r,rgb}[]} frame.blobs
   * @param {object[]} frame.pairs from computePairs
   * @param {object} frame.params
   * @param {{scale:number, ox:number, oy:number}} frame.view device-pixel transform
   * @param {{w:number,h:number}} frame.board
   */
  render(frame) {
    if (this.lost) return;
    const gl = this.gl;
    const { blobs, pairs, params, view, board } = frame;
    const nb = Math.min(blobs.length, LIMITS.maxBlobs);
    const np = Math.min(pairs.length, LIMITS.maxPairs);
    const D = this.data;

    for (let i = 0; i < nb; i++) {
      const b = blobs[i];
      const o = i * 16;
      D[o] = b.x; D[o + 1] = b.y; D[o + 2] = b.r; D[o + 3] = blobK(b.r, params);
      D[o + 4] = b.rgb[0]; D[o + 5] = b.rgb[1]; D[o + 6] = b.rgb[2]; D[o + 7] = 1;
    }
    const base = LIMITS.maxBlobs * 16;
    for (let j = 0; j < np; j++) {
      const p = pairs[j];
      const o = base + j * 16;
      D[o] = p.x0; D[o + 1] = p.y0; D[o + 2] = p.x1; D[o + 3] = p.y1;
      D[o + 4] = p.w0; D[o + 5] = p.w1; D[o + 6] = p.wMid; D[o + 7] = p.neck;
      D[o + 8] = p.bend; D[o + 9] = p.k; D[o + 10] = p.taper; D[o + 11] = p.ia;
      D[o + 12] = p.cx; D[o + 13] = p.cy; D[o + 14] = p.bound; D[o + 15] = p.ib;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (nb > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, nb, gl.RGBA, gl.FLOAT, D, 0);
    if (np > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, LIMITS.maxBlobs, 4, np, gl.RGBA, gl.FLOAT, D, base);

    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.u.uData, 0);
    gl.uniform1i(this.u.uBlobCount, nb);
    gl.uniform1i(this.u.uPairCount, np);
    gl.uniform1f(this.u.uCanvasH, H);
    gl.uniform1f(this.u.uScale, view.scale);
    gl.uniform2f(this.u.uOffset, view.ox, view.oy);
    gl.uniform2f(this.u.uBoard, board.w, board.h);
    const bg = hexToRgb(frame.background);
    gl.uniform3f(this.u.uBg, bg[0], bg[1], bg[2]);
    const st = hexToRgb(frame.stage || '#0f0f10');
    gl.uniform3f(this.u.uStage, st[0], st[1], st[2]);
    gl.uniform1f(this.u.uTransparent, frame.transparent ? 1 : 0);
    gl.uniform1f(this.u.uChecker, frame.checker ? 1 : 0);
    gl.uniform1f(this.u.uClip, frame.clip === false ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
