// 탱크는 몸체(<color>_body.png, 1536×1024)와 공용 포신(po.png, 2172×724) 두 장으로 그린다.
// 좌표 상수(TANK_SHEET)는 포구 위치 판정에도 쓰이므로 @fortress/shared 에 있다.
// 런타임에 미리 축소한 캔버스 텍스처로 만든다 (축소 계단 현상 방지).
import type Phaser from 'phaser';
import { FFA_COLORS, TANK_SHEET } from '@fortress/shared';

export { TANK_SHEET };

/** 빨간 계열 픽셀(색상 0±30°, 채도 있음)의 색상만 hue(도)로 바꾼다. 밝기·채도는 유지 */
function recolorReds(d: Uint8ClampedArray, hue: number): void {
  const h2 = hue / 360;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (max !== r || delta < 0.12) continue;           // 빨강이 가장 강하고 채도가 있는 픽셀만
    const h = ((g - b) / delta) * 60;                    // -60 ~ 60 (빨강 = 0)
    if (h > 30 || h < -30) continue;                     // 주황빛(크림색 장갑·불빛)은 그대로
    const l = (max + min) / 2;
    const s = delta / (1 - Math.abs(2 * l - 1) || 1);
    const nh = (h2 + h / 360 + 1) % 1;
    // HSL → RGB
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const ch = (t: number) => {
      const u = (t + 1) % 1;
      if (u < 1 / 6) return p + (q - p) * 6 * u;
      if (u < 1 / 2) return q;
      if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
      return p;
    };
    d[i] = ch(nh + 1 / 3) * 255;
    d[i + 1] = ch(nh) * 255;
    d[i + 2] = ch(nh - 1 / 3) * 255;
  }
}

export interface BarrelInfo {
  /** 포신 텍스처에서 회전축 위치 (0~1) */
  origin: { x: number; y: number };
}

/** 로드된 이미지 텍스처의 원본 이미지 */
export function sourceImage(scene: Phaser.Scene, key: string): HTMLImageElement | HTMLCanvasElement {
  return scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
}

export function sliceTanks(scene: Phaser.Scene): BarrelInfo {
  const S = TANK_SHEET;
  const P = S.PO;
  // 포신은 수평(총구가 왼쪽)으로 그려져 있으므로 회전 없이 축소만 한다.

  for (const name of S.COLORS) {
    const bodyImg = sourceImage(scene, `tank_${name}_body_src`);
    const body = scene.textures.createCanvas(
      `tank_${name}_body`, Math.ceil(bodyImg.width * S.SCALE), Math.ceil(bodyImg.height * S.SCALE),
    )!;
    body.context.imageSmoothingQuality = 'high';
    body.context.drawImage(bodyImg, 0, 0, body.width, body.height);
    body.refresh();
  }

  // 개인전 색: 레드 몸체에서 빨간 부분만 색상을 돌려 만든다 (크림색 장갑·회색 바퀴는 그대로)
  const red = scene.textures.get('tank_red_body').getSourceImage() as HTMLCanvasElement;
  for (const c of FFA_COLORS) {
    if (c.hue === undefined || scene.textures.exists(`tank_${c.sprite}_body`)) continue;
    const tex = scene.textures.createCanvas(`tank_${c.sprite}_body`, red.width, red.height)!;
    const ctx = tex.context;
    ctx.drawImage(red, 0, 0);
    const img = ctx.getImageData(0, 0, red.width, red.height);
    recolorReds(img.data, c.hue);
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }

  // 길이 줄이기: 굵기가 일정한 가운데 관 부분을 잘라 내고 양쪽을 붙인다.
  // (통째로 가로 축소하면 고리·총구가 납작해지므로)
  const poImg = sourceImage(scene, 'tank_po_src');
  const k = S.SCALE * P.SCALE;
  const cutLen = Math.round((P.PIVOT.x - P.MUZZLE.x) * (1 - P.LENGTH));
  const cutStart = P.TUBE_CUT_START;
  const srcW = poImg.width - cutLen;               // 잘라 낸 뒤 포신 이미지 폭
  const pivotX = P.PIVOT.x - cutLen;
  const barrel = scene.textures.createCanvas('tank_barrel', Math.ceil(srcW * k), Math.ceil(poImg.height * k))!;
  const bc = barrel.context;
  bc.imageSmoothingQuality = 'high';
  bc.scale(k, k);
  bc.drawImage(poImg, 0, 0, cutStart, poImg.height, 0, 0, cutStart, poImg.height);
  bc.drawImage(poImg, cutStart + cutLen, 0, poImg.width - cutStart - cutLen, poImg.height,
    cutStart, 0, poImg.width - cutStart - cutLen, poImg.height);
  barrel.refresh();

  // origin: 포신 텍스처에서 회전축 위치 (0~1)
  return { origin: { x: pivotX / srcW, y: P.PIVOT.y / poImg.height } };
}

// arrow.png는 회전하는 화살표 5칸이 가로로 이어진 시트다 (칸 폭이 정수로 나뉘지 않음).
// 투명한 세로 틈을 찾아 칸을 나누고 프레임으로 등록한다. 마지막 칸은 첫 칸과 같은 앞면이라
// 반복 재생 시 앞면이 두 번 연속되지 않도록 뺀다.
export function sliceArrow(scene: Phaser.Scene): string[] {
  const tex = scene.textures.get('arrow');
  const img = tex.getSourceImage() as HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const filled = (x: number): boolean => {
    for (let y = 0; y < img.height; y++) if (d[(y * img.width + x) * 4 + 3] > 16) return true;
    return false;
  };
  const runs: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= img.width; x++) {
    const f = x < img.width && filled(x);
    if (f && start < 0) start = x;
    if (!f && start >= 0) { runs.push([start, x]); start = -1; }
  }
  // 칸 폭을 가장 넓은 칸에 맞춰 중심 정렬해야 회전할 때 좌우로 흔들리지 않는다.
  const maxW = Math.max(...runs.map(([a, b]) => b - a));
  const names: string[] = [];
  runs.slice(0, Math.max(1, runs.length - 1)).forEach(([a, b], i) => {
    const cx = (a + b) / 2;
    const x0 = Math.max(0, Math.round(cx - maxW / 2));
    const w = Math.min(maxW, img.width - x0);
    tex.add(`f${i}`, 0, x0, 0, w, img.height);
    names.push(`f${i}`);
  });
  return names;
}
