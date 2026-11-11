// 파괴 가능한 땅의 충돌 마스크 (1 = 땅, 0 = 빈 칸).
// 그리기는 하지 않는다. 땅을 바꾸는 함수는 화면에 반영할 내용(지운 칸, 그을음 선)을 돌려주고,
// 클라이언트의 Terrain(그리기 담당)이 그것을 캔버스에 그린다. 서버는 마스크만 쓴다.
import { RULES } from './config';
import { clamp } from './math';
import type { Rng } from './rng';

export interface Anchor { x: number; y: number; r: number }
export interface Platform { x0: number; x1: number }
interface BBox { minX: number; minY: number; maxX: number; maxY: number }

/** 지운 세로 줄 목록 [x, y, h, x, y, h, ...] 과 그을음을 그릴 바닥선 [x, y, x, y, ...] */
export interface EraseOps { erase: number[]; bottom: number[] }

export type CarveResult =
  | { kind: 'round'; cx: number; cy: number; r: number }
  | ({ kind: 'bowl' } & EraseOps);

export class TerrainMask {
  readonly w: number;
  readonly h: number;
  /** 모양이 바뀔 때마다 증가 (미니맵·디버그 갱신용) */
  version = 0;
  readonly solid: Uint8Array;
  private readonly mark: Uint8Array;
  private readonly queue: Int32Array;
  anchors: Anchor[] = [];

  /** solid는 그대로 가져다 쓴다 (복사하지 않음). 작은 잡티를 지우고 떠 있는 섬의 고정점을 찾는다. */
  constructor(w: number, h: number, solid: Uint8Array) {
    if (solid.length !== w * h) throw new Error(`mask size mismatch: ${solid.length} != ${w}x${h}`);
    this.w = w;
    this.h = h;
    this.solid = solid;
    const n = w * h;
    this.mark = new Uint8Array(n);
    this.queue = new Int32Array(n);
    this.removeSpecks();
    this.anchors = this.findAnchors();
  }

  // ---- 질의 ----

  isSolid(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h) return false;
    return this.solid[iy * this.w + ix] === 1;
  }

  // fromY부터 아래로 내려가며 처음 만나는 땅의 y. 없으면 null.
  surfaceY(x: number, fromY: number): number | null {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.w) return null;
    for (let y = Math.max(0, Math.floor(fromY)); y < this.h; y++) {
      if (this.solid[y * this.w + ix] === 1) return y;
    }
    return null;
  }

  // 위에서 내려다본 표면이 끊기지 않고 이어지는 구간(발판)들을 찾는다.
  // 이웃 열과 표면 높이 차가 maxStep 이하면 같은 발판으로 본다. [{x0, x1}] (양 끝 포함)
  findPlatforms(minWidth: number, maxStep = 12, margin = 20): Platform[] {
    const out: Platform[] = [];
    let start = -1;
    let prev: number | null = null;
    const close = (end: number) => {
      if (start >= 0 && end - start + 1 >= minWidth) out.push({ x0: start, x1: end });
      start = -1;
    };
    for (let x = margin; x < this.w - margin; x++) {
      const y = this.surfaceY(x, 0);
      if (y === null || (prev !== null && Math.abs(y - prev) > maxStep)) close(x - 1);
      if (y !== null && start < 0) start = x;
      prev = y;
    }
    close(this.w - margin - 1);
    return out;
  }

  // ---- 연결 요소 탐색 (4방향) ----

  // queue[0..tail)에 시드가 들어 있고 mark가 이미 찍혀 있어야 한다. 새 tail을 돌려준다.
  private flood(tail: number): number {
    const { w, solid, mark, queue } = this;
    const last = solid.length - w;
    let head = 0;
    const visit = (j: number) => {
      if (solid[j] === 1 && mark[j] === 0) {
        mark[j] = 1;
        queue[tail++] = j;
      }
    };
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < last) visit(i + w);
    }
    return tail;
  }

  // 아직 mark되지 않은 땅 덩어리마다 fn(count, bbox)를 호출한다. 픽셀 목록은 queue[0..count).
  private eachComponent(fn: (count: number, bbox: BBox) => void): void {
    const { w, solid, mark, queue } = this;
    for (let i = 0; i < solid.length; i++) {
      if (solid[i] !== 1 || mark[i] !== 0) continue;
      mark[i] = 1;
      queue[0] = i;
      const count = this.flood(1);
      let minX = w;
      let minY = this.h;
      let maxX = 0;
      let maxY = 0;
      for (let k = 0; k < count; k++) {
        const p = queue[k];
        const x = p % w;
        const y = (p - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      fn(count, { minX, minY, maxX, maxY });
    }
  }

  // 맨 아래 행과 고정점에서 시작해 연결된 땅을 mark한다.
  private markAnchored(): void {
    const { w, h, solid, mark, queue } = this;
    mark.fill(0);
    let tail = 0;
    const seed = (i: number) => {
      if (solid[i] === 1 && mark[i] === 0) {
        mark[i] = 1;
        queue[tail++] = i;
      }
    };
    for (let x = 0; x < w; x++) seed((h - 1) * w + x);
    for (const a of this.anchors) {
      for (let y = Math.max(0, a.y - a.r); y <= Math.min(h - 1, a.y + a.r); y++) {
        for (let x = Math.max(0, a.x - a.r); x <= Math.min(w - 1, a.x + a.r); x++) {
          if ((x - a.x) ** 2 + (y - a.y) ** 2 <= a.r * a.r) seed(y * w + x);
        }
      }
    }
    this.flood(tail);
  }

  // ---- 로드 시 정리 ----

  // 작은 잡티 덩어리를 지운다. (반투명 외곽 번짐 정리는 그리기 쪽에서 이 마스크를 보고 한다)
  private removeSpecks(): void {
    const { solid, queue } = this;
    const min = RULES.TERRAIN.SPECK_MIN;
    this.mark.fill(0);
    this.eachComponent((count) => {
      if (count < min) for (let k = 0; k < count; k++) solid[queue[k]] = 0;
    });
  }

  // 처음부터 떠 있는 섬마다 중심에 가장 가까운 픽셀에 고정점을 둔다.
  private findAnchors(): Anchor[] {
    const { w, queue } = this;
    const anchors: Anchor[] = [];
    this.anchors = [];
    this.markAnchored();
    this.eachComponent((count, b) => {
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      let best = queue[0];
      let bestD = Infinity;
      for (let k = 0; k < count; k++) {
        const p = queue[k];
        const x = p % w;
        const dd = (x - cx) ** 2 + ((p - x) / w - cy) ** 2;
        if (dd < bestD) { bestD = dd; best = p; }
      }
      anchors.push({ x: best % w, y: Math.floor(best / w), r: RULES.TERRAIN.ANCHOR_RADIUS });
    });
    return anchors;
  }

  // ---- 변형 ----

  // 착탄점 주변의 빈 칸 방향(= 지형 표면의 바깥쪽 법선)을 구한다.
  surfaceNormal(cx: number, cy: number, R = 12): { nx: number; ny: number } {
    let nx = 0;
    let ny = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        if (!this.isSolid(cx + dx, cy + dy)) { nx += dx; ny += dy; }
      }
    }
    return { nx, ny };
  }

  // rng는 사발 바닥의 울퉁불퉁함에만 쓴다 (서버·클라가 같은 시드면 같은 모양).
  carve(cx: number, cy: number, r: number, rng: Rng): CarveResult {
    // 발판 옆면(벽)에 맞았으면 열 단위 사발 대신 둥글게 판다.
    // 열 단위로 파면 옆면에서는 위아래가 통째로 지워져 네모나게 잘려 보이기 때문.
    const n = this.surfaceNormal(cx, cy);
    // 옆면 판정과 상관없이 난수는 항상 두 번 뽑는다 (갈래에 따라 수열이 어긋나지 않게).
    const ph1 = rng.next() * Math.PI * 2;
    const ph2 = rng.next() * Math.PI * 2;
    if (Math.abs(n.nx) > Math.abs(n.ny) * 1.2) return this.carveRound(cx, cy, r);
    return this.carveBowl(cx, cy, r, ph1, ph2);
  }

  // 옆면 착탄: 원형으로 판다
  private carveRound(cx: number, cy: number, r: number): CarveResult {
    const { w, solid } = this;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) solid[y * w + x] = 0;
      }
    }
    this.version++;
    return { kind: 'round', cx, cy, r };
  }

  // 윗면 착탄: 열 단위 사발 모양.
  // 바닥은 평평한 사발 모양이고, 구덩이 위로 얇게 남는 흙(처마)은 함께 걷어 내 공중에 뜬 흙이 생기지 않게 한다.
  private carveBowl(cx: number, cy: number, r: number, ph1: number, ph2: number): CarveResult {
    const { w, h, solid } = this;
    const depth = r * 0.72;        // 폭발 중심 아래로 파이는 깊이
    const FLAT = 0.35;             // 중심에서 이 비율까지는 평평한 바닥, 바깥은 둥근 어깨
    const lipMax = r * 1.1;        // 이 두께 이하의 처마만 걷어 낸다 (두꺼운 절벽은 남김)
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));

    const erase: number[] = [];
    const bottom: number[] = [];
    for (let x = x0; x <= x1; x++) {
      const t = Math.min(1, Math.abs(x - cx) / r);
      // 바닥선에 약간의 울퉁불퉁함을 준다 (가장자리로 갈수록 0).
      const wobble = (Math.sin(x * 0.11 + ph1) * 0.6 + Math.sin(x * 0.27 + ph2) * 0.4) * r * 0.06 * (1 - t);
      // 코사인 어깨: 가장자리에서 기울기가 0이라 수직 턱이 생기지 않는다 (최대 약 60°).
      const u = Math.max(0, (t - FLAT) / (1 - FLAT));
      const prof = (1 + Math.cos(Math.PI * u)) / 2;
      const yb = Math.min(h - 1, Math.round(cy + depth * prof + wobble));
      const half = Math.sqrt(Math.max(0, 1 - t * t)) * r * 0.85;
      let yt = Math.max(0, Math.round(cy - half));

      // 위쪽 처마: 폭발 범위 위로 이어진 흙 덩어리 두께를 재서 얇으면 같이 걷어 낸다.
      let y = yt - 1;
      while (y >= 0 && solid[y * w + x] === 1 && yt - y <= lipMax) y--;
      if (y < 0 || solid[y * w + x] === 0) yt = y + 1;

      if (yb >= yt) {
        for (let yy = yt; yy <= yb; yy++) solid[yy * w + x] = 0;
        erase.push(x, yt, yb - yt + 1);
      }
      bottom.push(x, yb);
    }

    // 경사면에 맞아 처마를 걷어 낸 경우 구덩이 옆에 수직 벽이 남는다.
    // 중심에서 바깥으로 가며 이웃 열과의 높이 차를 STEP px 이하로 깎아 경사로 이어 준다.
    const STEP = 2;                                 // 열당 최대 높이 차 (약 63°, 등판 한계보다 완만)
    const ext = Math.round(r * 0.6);                // 폭발 범위 밖으로 깎을 수 있는 최대 폭
    const yTop = Math.max(0, Math.round(cy - r * 1.6));
    // 표면은 구덩이 바닥 근처까지만 찾는다. 그 아래(발판이 뚫려 보이는 먼 땅)를 기준으로 삼으면
    // 발판 전체가 세로로 통째로 깎여 나가기 때문.
    const yLow = Math.min(h - 1, Math.round(cy + depth + 6));
    // -1: 위쪽 한계부터 흙(절벽), null: 구덩이 깊이 안에 흙 없음(뚫림)
    const surf = (x: number): number | null => {
      if (solid[yTop * w + x] === 1) return -1;
      for (let y = yTop + 1; y <= yLow; y++) if (solid[y * w + x] === 1) return y;
      return null;
    };
    const cxi = Math.round(clamp(cx, 0, w - 1));
    for (const dir of [1, -1]) {
      let prev = surf(cxi);
      if (prev === -1) continue;
      const end = dir > 0 ? Math.min(w - 1, x1 + ext) : Math.max(0, x0 - ext);
      for (let x = cxi + dir; dir > 0 ? x <= end : x >= end; x += dir) {
        let s = surf(x);
        if (s === -1) break;
        // 뚫린 열이거나 기준(prev)이 뚫린 열이면 깎지 않고 기준만 갱신
        if (s === null || prev === null) {
          if (s === null && (dir > 0 ? x > x1 : x < x0)) break;
          prev = s;
          continue;
        }
        const limit = prev - STEP;
        if (s < limit) {
          for (let y = s; y < limit; y++) solid[y * w + x] = 0;
          erase.push(x, s, limit - s);
          s = surf(x);
        } else if (dir > 0 ? x > x1 : x < x0) {
          break; // 범위 밖에서 더 깎을 필요가 없으면 끝
        }
        prev = s;
      }
    }

    this.version++;
    return { kind: 'bowl', erase, bottom };
  }

  // 표면을 위에서 눌러 낸 듯 얕게 판다 (탱크가 땅에 박히는 자국).
  // [x0, x1] 각 열에서 fromY 아래 첫 표면부터 depthAt(x) px만큼 지운다. maxY보다 낮은 표면은 건드리지 않는다.
  pressDown(x0: number, x1: number, fromY: number, maxY: number, depthAt: (x: number) => number): EraseOps {
    const { w, solid } = this;
    const erase: number[] = [];
    const bottom: number[] = [];
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, Math.ceil(x1)); x++) {
      const y = this.surfaceY(x, fromY);
      const d = Math.round(depthAt(x));
      if (y === null || y > maxY || d <= 0) continue;
      for (let yy = y; yy < y + d; yy++) solid[yy * w + x] = 0;
      erase.push(x, y, d);
      bottom.push(x, y + d);
    }
    this.version++;
    return { erase, bottom };
  }
}

// ---- 마스크 파일 (tools/build-mask.mjs 가 만든 RLE) ----

/**
 * RLE 디코딩. 0 런부터 시작해 0/1 런 길이가 번갈아 LEB128 가변 길이로 들어 있다 (base64).
 */
export function decodeMask(w: number, h: number, rleBase64: string): Uint8Array {
  const bin = atob(rleBase64);
  const out = new Uint8Array(w * h);
  let pos = 0;
  let value = 0;
  let i = 0;
  while (i < bin.length) {
    let len = 0;
    let shift = 0;
    let b: number;
    do {
      b = bin.charCodeAt(i++);
      len += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    if (value === 1) out.fill(1, pos, pos + len);
    pos += len;
    value ^= 1;
  }
  if (pos !== w * h) throw new Error(`mask RLE length ${pos} != ${w * h}`);
  return out;
}

declare function atob(data: string): string;
