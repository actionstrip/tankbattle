// tanks.png는 2칸짜리 시트이고 포신이 몸체에 붙어 있다.
// 런타임에 잘라 몸체 텍스처와, 수평으로 눕힌 포신 텍스처를 만든다. 원본은 바뀌지 않는다.
const TANK_SHEET = {
  CELL_W: 1086,
  CELL_H: 724,
  CELLS: { blue: 0, red: 1 },
  SCALE: 0.25,               // 축소 시 계단 현상을 막기 위해 미리 줄여 둔다
  ORIGIN: { x: 597, y: 695 }, // 궤도 바닥 중앙 (셀 좌표)
  PIVOT: { x: 425, y: 268 },  // 포신 회전축 (셀 좌표)
  MUZZLE: { x: 141, y: 80 },  // 총구 중심 (셀 좌표)
  HEAD_LEN: 215,              // 총구에서 굵은 부분이 끝나는 거리
  HEAD_HALF: 88,
  TIP_PAD: 40,                // 총구 끝 너머까지 지워 외곽선이 남지 않게 한다
  NECK_HALF: 54,
  ERASE_TAIL: 62,             // 칼라를 몸체에 남기기 위해 지우지 않는 뿌리 쪽 길이
};

function sliceTanks(scene) {
  const S = TANK_SHEET;
  const sheet = scene.textures.get('tanks').getSourceImage();
  const dx = S.PIVOT.x - S.MUZZLE.x;
  const dy = S.PIVOT.y - S.MUZZLE.y;
  const length = Math.hypot(dx, dy);
  const baseAngle = Math.atan2(dy, dx);

  // 포신 외곽선. 회전축 기준이며 -x가 총구 쪽이다.
  const outline = (ctx, tail) => {
    const tip = -length - S.TIP_PAD;
    ctx.beginPath();
    ctx.moveTo(tip, -S.HEAD_HALF);
    ctx.lineTo(-length + S.HEAD_LEN, -S.HEAD_HALF);
    ctx.lineTo(-length + S.HEAD_LEN + 16, -S.NECK_HALF);
    ctx.lineTo(-tail, -S.NECK_HALF);
    ctx.lineTo(-tail, S.NECK_HALF);
    ctx.lineTo(-length + S.HEAD_LEN + 16, S.NECK_HALF);
    ctx.lineTo(-length + S.HEAD_LEN, S.HEAD_HALF);
    ctx.lineTo(tip, S.HEAD_HALF);
    ctx.closePath();
  };

  for (const [name, cell] of Object.entries(S.CELLS)) {
    const cellX = cell * S.CELL_W;

    const body = scene.textures.createCanvas(
      `tank_${name}_body`, Math.ceil(S.CELL_W * S.SCALE), Math.ceil(S.CELL_H * S.SCALE),
    );
    const bctx = body.context;
    bctx.imageSmoothingQuality = 'high';
    bctx.scale(S.SCALE, S.SCALE);
    bctx.drawImage(sheet, cellX, 0, S.CELL_W, S.CELL_H, 0, 0, S.CELL_W, S.CELL_H);
    bctx.translate(S.PIVOT.x, S.PIVOT.y);
    bctx.rotate(baseAngle);
    bctx.globalCompositeOperation = 'destination-out';
    outline(bctx, S.ERASE_TAIL);
    bctx.fill();
    body.refresh();

    const pad = S.TIP_PAD + 2;
    const barrelW = length + pad;
    const barrelH = S.HEAD_HALF * 2 + pad;
    const barrel = scene.textures.createCanvas(
      `tank_${name}_barrel`, Math.ceil(barrelW * S.SCALE), Math.ceil(barrelH * S.SCALE),
    );
    const cctx = barrel.context;
    cctx.imageSmoothingQuality = 'high';
    cctx.scale(S.SCALE, S.SCALE);
    cctx.translate(barrelW, barrelH / 2); // 회전축 = 텍스처 오른쪽 가운데
    outline(cctx, 0);
    cctx.clip();
    cctx.rotate(-baseAngle);
    cctx.translate(-S.PIVOT.x, -S.PIVOT.y);
    cctx.drawImage(sheet, cellX, 0, S.CELL_W, S.CELL_H, 0, 0, S.CELL_W, S.CELL_H);
    barrel.refresh();
  }

  return { length, baseAngle };
}
