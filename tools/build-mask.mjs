// 땅 이미지(PNG)의 알파값으로 충돌 마스크를 만들어 packages/shared/src/stage1Mask.ts 로 저장한다.
// 클라이언트와 서버가 같은 마스크를 쓰게 하려고 미리 만들어 둔다. 땅 이미지를 바꾸면 다시 실행:
//   npm run build:mask
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = `${root}apps/client/public/images/background/stage1_ground.png`;
const OUT = `${root}packages/shared/src/stage1Mask.ts`;
const WORLD_W = 2560;
const WORLD_H = 768;
const ALPHA_SOLID = 128; // RULES.TERRAIN.ALPHA_SOLID 와 같은 값

const png = PNG.sync.read(readFileSync(SRC));
if (png.width !== WORLD_W || png.height !== WORLD_H) {
  // 지금 그림은 월드와 크기가 같아 확대 없이 그대로 쓴다. 크기가 다르면 확대 규칙을 정해야 한다.
  throw new Error(`땅 이미지 크기 ${png.width}x${png.height} 가 월드 ${WORLD_W}x${WORLD_H} 와 다름`);
}

// 0 런부터 시작해 0/1 런 길이를 번갈아 LEB128 가변 길이로 기록
const bytes = [];
const pushLen = (n) => {
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    bytes.push(b);
  } while (n > 0);
};
let value = 0;
let run = 0;
let solidCount = 0;
for (let i = 0; i < WORLD_W * WORLD_H; i++) {
  const v = png.data[i * 4 + 3] >= ALPHA_SOLID ? 1 : 0;
  solidCount += v;
  if (v === value) { run++; continue; }
  pushLen(run);
  value = v;
  run = 1;
}
pushLen(run);

const b64 = Buffer.from(bytes).toString('base64');
const lines = b64.match(/.{1,120}/g).map((l) => `    '${l}'`).join(',\n');
writeFileSync(OUT, `// 자동 생성 파일 (tools/build-mask.mjs). 직접 고치지 말 것.
// 원본: apps/client/public/images/background/stage1_ground.png, 알파 >= ${ALPHA_SOLID} 이면 땅
export const STAGE1_MASK = {
  w: ${WORLD_W},
  h: ${WORLD_H},
  rle: [
${lines},
  ].join(''),
};
`);
console.log(`stage1Mask.ts: 땅 ${solidCount}px, RLE ${bytes.length} bytes (base64 ${b64.length})`);
