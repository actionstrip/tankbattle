// CPU 조준: 후보 샷을 시뮬레이션해 상대와 가장 가까운 샷을 고르고 오차를 섞는다.
// 파워 1의 차이가 착탄 지점을 30px 안팎 옮기므로 오차는 작게 둔다.
import { RULES } from './config';
import { clamp } from './math';
import { simulateShot } from './projectile';
import type { Rng } from './rng';
import type { TankBody } from './tankBody';
import type { TerrainMask } from './terrainMask';

const AI_ERROR = { ELEVATION: 1.5, POWER: 1.5 };

export interface AiPlan {
  facing: number;
  weapon: number;
  elevation: number;
  power: number;
}

export function planAiShot(
  tank: TankBody, enemy: TankBody, wind: number, terrain: TerrainMask, tanks: readonly TankBody[], rng: Rng,
): AiPlan {
  const targetX = enemy.x;
  const targetY = enemy.y - RULES.TANK.HIT_CENTER_Y;
  const facing = enemy.x >= tank.x ? 1 : -1;
  const savedFacing = tank.facing;
  tank.facing = facing;

  let best = { dist: Infinity, elevation: 45, power: 60 };
  for (let elevation = 15; elevation <= 80; elevation += 5) {
    const muzzle = tank.muzzle(elevation);
    for (let power = 24; power <= 100; power += 3) {
      const r = simulateShot(muzzle, power, wind, terrain, tanks, tank);
      const dist = Math.hypot(r.x - targetX, r.y - targetY);
      if (dist < best.dist) best = { dist, elevation, power };
    }
  }
  tank.facing = savedFacing;

  const usable = RULES.WEAPONS
    .map((_w, i) => i)
    .filter((i) => tank.stock[i] > 0);
  const weapon = rng.pick(usable);

  return {
    facing,
    weapon,
    elevation: clamp(
      best.elevation + rng.float(-AI_ERROR.ELEVATION, AI_ERROR.ELEVATION),
      RULES.TANK.ELEV_MIN, RULES.TANK.ELEV_MAX,
    ),
    power: clamp(best.power + rng.float(-AI_ERROR.POWER, AI_ERROR.POWER), 5, 100),
  };
}
