import { RULES } from './config';
import { STAGE1_MASK } from './stage1Mask';
import { TerrainMask, decodeMask } from './terrainMask';

/** 스테이지 1 지형 마스크 원본 (잡티 정리 전). 호출할 때마다 새 배열 */
export function loadStageSolid(): { w: number; h: number; solid: Uint8Array } {
  const { w, h, rle } = STAGE1_MASK;
  if (w !== RULES.WORLD_W || h !== RULES.WORLD_H) throw new Error('stage mask size != world size');
  return { w, h, solid: decodeMask(w, h, rle) };
}

/** 스테이지 1 지형 마스크를 새로 만든다 (게임마다 새로 — 파인 땅이 남지 않게) */
export function createStageMask(): TerrainMask {
  const { w, h, solid } = loadStageSolid();
  return new TerrainMask(w, h, solid);
}
