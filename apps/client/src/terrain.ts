// 파괴 가능한 땅 레이어 (그리기 담당).
// 충돌 판정은 @fortress/shared 의 TerrainMask(미리 만든 마스크)가 하고, 이 클래스는 그것을 화면에 그린다.
// stage1_ground.png를 월드 폭에 맞춰 하단 정렬로 깔고, 포탄이 파낸 자리는 투명하게 지워
// 화면에 고정된 배경이 그대로 보이게 한다.
import type Phaser from 'phaser';
import { TerrainMask, loadStageSolid } from '@fortress/shared';
import type { CarveResult, EraseOps, Rng } from '@fortress/shared';
import { CONFIG } from './config';
import { sourceImage } from './tankSlicer';

export type { Anchor, Platform } from '@fortress/shared';

const SOOT = 'rgba(18, 9, 5, ';

export class Terrain extends TerrainMask {
  readonly scene: Phaser.Scene;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: Phaser.Textures.CanvasTexture;

  constructor(scene: Phaser.Scene) {
    const { w, h, solid } = loadStageSolid();
    super(w, h, solid);
    this.scene = scene;

    // 조각을 떼어 낼 때 getImageData를 자주 쓰므로 CPU 쪽 캔버스로 만든다.
    // (GPU 가속 캔버스는 읽을 때마다 수백 ms씩 걸릴 수 있다)
    if (scene.textures.exists('terrain')) scene.textures.remove('terrain');
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.texture = scene.textures.addCanvas('terrain', canvas)!;

    const src = sourceImage(scene, 'ground');
    const drawH = Math.round((src.height * this.w) / src.width);
    this.ctx.drawImage(src, 0, this.h - drawH, this.w, drawH);

    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    this.clearFringe(img);
    this.ctx.putImageData(img, 0, 0);
    this.texture.refresh();

    scene.add.image(0, 0, 'terrain').setOrigin(0).setDepth(CONFIG.DEPTH.TERRAIN);
  }

  // 원본 풀 외곽의 반투명 번짐과 (마스크에서 지운) 작은 잡티를 그림에서도 지운다.
  // 땅에서 FRINGE px 안쪽만 남긴다 (가로·세로 분리 팽창).
  private clearFringe(img: ImageData): void {
    const { w, h, solid } = this;
    const r = CONFIG.TERRAIN.FRINGE;
    const horiz = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (solid[row + x] !== 1) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) horiz[row + nx] = 1;
        }
      }
    }
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let near = 0;
        for (let dy = -r; dy <= r && !near; dy++) {
          const ny = y + dy;
          if (ny >= 0 && ny < h) near = horiz[ny * w + x];
        }
        if (!near) d[(y * w + x) * 4 + 3] = 0;
      }
    }
  }

  // ---- 변형 (마스크를 바꾸고 같은 모양으로 그림을 지운다) ----

  override carve(cx: number, cy: number, r: number, rng: Rng): CarveResult {
    const res = super.carve(cx, cy, r, rng);
    if (res.kind === 'round') this.paintRound(res.cx, res.cy, res.r);
    else this.paintErase(res, [[28, 0.45, 6], [10, 0.75, 2]]);
    return res;
  }

  override pressDown(x0: number, x1: number, fromY: number, maxY: number, depthAt: (x: number) => number): EraseOps {
    const ops = super.pressDown(x0, x1, fromY, maxY, depthAt);
    // 눌린 바닥을 따라 살짝 그을린 자국
    this.paintErase(ops, ops.bottom.length >= 4 ? [[6, 0.5, 2]] : []);
    return ops;
  }

  /** 서버·다른 경로에서 받은 지운 칸 목록을 그림에만 반영할 때도 쓴다 */
  paintErase(ops: EraseOps, soot: [width: number, alpha: number, blur: number][]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const e = ops.erase;
    for (let k = 0; k < e.length; k += 3) ctx.fillRect(e[k], e[k + 1], 1, e[k + 2]);

    // 파인 바닥을 따라 그을음을 입힌다 (남은 흙 위에만).
    const b = ops.bottom;
    if (soot.length && b.length >= 2) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const [width, alpha, blur] of soot) {
        ctx.filter = blur ? `blur(${blur}px)` : 'none';
        ctx.strokeStyle = `${SOOT}${alpha})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let k = 0; k < b.length; k += 2) {
          if (k === 0) ctx.moveTo(b[k], b[k + 1]);
          else ctx.lineTo(b[k], b[k + 1]);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
    this.texture.refresh();
  }

  // 옆면 착탄: 원형으로 지우고 가장자리에 그을음
  private paintRound(cx: number, cy: number, r: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-atop';
    const grad = ctx.createRadialGradient(cx, cy, r, cx, cy, r + 14);
    grad.addColorStop(0, `${SOOT}0.75)`);
    grad.addColorStop(1, `${SOOT}0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.texture.refresh();
  }
}
