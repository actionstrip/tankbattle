// 탱크는 몸체(<color>_body.png, 1536×1024)와 공용 포신(po.png, 2172×724) 두 장으로 그린다.
// 좌표는 모두 몸체 이미지 픽셀 기준이다. 포신의 크기·위치는 사용자가 맞춘 배치 시안과
// 픽셀 대조로 구했다 (시안에서 몸체 0.5배, 포신 0.304배 → 포신은 몸체 대비 0.608배).
// 런타임에 미리 축소한 캔버스 텍스처로 만든다 (축소 계단 현상 방지).
import type Phaser from 'phaser';

export const TANK_SHEET = {
  SCALE: 0.16,                 // 몸체 이미지 → 텍스처 축소 배율 (화면 크기는 CONFIG.TANK.SCALE을 한 번 더 곱함)
  ORIGIN: { x: 765, y: 955 },  // 궤도 바닥 중앙 (몸체 좌표)
  PO: {
    SCALE: 0.608,              // 포신 이미지 → 몸체 좌표 배율
    LENGTH: 2 / 3,             // 회전축~총구 길이 배율 (가운데 관을 잘라 내 줄임, 굵기·모양 유지)
    TUBE_CUT_START: 900,       // 잘라 낼 관 구간 시작 x (관은 약 x 565~1550)
    PIVOT: { x: 1864, y: 364 },  // 포신 이미지 안 회전축 (오른쪽 둥근 고리 중심)
    MUZZLE: { x: 168, y: 362 },  // 포신 이미지 안 총구 끝 중심
  },
  // 포신 회전축이 놓이는 몸체 좌표 (포탑 앞쪽)
  PIVOT: { x: 862, y: 306 },
  COLORS: ['blue', 'red'],
};

export interface BarrelInfo {
  /** 몸체 좌표 기준 회전축~총구 거리 */
  length: number;
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
  const length = (P.PIVOT.x - P.MUZZLE.x) * P.SCALE * P.LENGTH; // 몸체 좌표 기준 회전축~총구 거리

  for (const name of S.COLORS) {
    const bodyImg = sourceImage(scene, `tank_${name}_body_src`);
    const body = scene.textures.createCanvas(
      `tank_${name}_body`, Math.ceil(bodyImg.width * S.SCALE), Math.ceil(bodyImg.height * S.SCALE),
    )!;
    body.context.imageSmoothingQuality = 'high';
    body.context.drawImage(bodyImg, 0, 0, body.width, body.height);
    body.refresh();
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
  return { length, origin: { x: pivotX / srcW, y: P.PIVOT.y / poImg.height } };
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
