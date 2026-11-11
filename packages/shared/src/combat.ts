// 폭발 세기·피해·직격 자국 계산 (그리기 없음).
import { BODY_TEXTURE_W, RULES } from './config';
import type { Weapon } from './config';
import { clamp } from './math';
import type { ShotTarget } from './projectile';
import type { EraseOps, TerrainMask } from './terrainMask';

/** 착탄 속도에 따른 구덩이 반경·데미지 배율. 빠를수록 크다. 속도를 모르면 1 */
export function impactScale(speed?: number): number {
  if (speed === undefined) return 1;
  const P = RULES.PHYSICS;
  const k = clamp((speed - P.IMPACT_SPEED_MIN) / (P.IMPACT_SPEED_MAX - P.IMPACT_SPEED_MIN), 0, 1);
  return P.IMPACT_SCALE_MIN + (P.IMPACT_SCALE_MAX - P.IMPACT_SCALE_MIN) * k;
}

export function blastOf(weapon: Weapon, speed?: number): { scale: number; radius: number; damage: number } {
  const scale = impactScale(speed);
  return { scale, radius: weapon.radius * scale, damage: weapon.damage * scale };
}

/** (x, y)에서 터진 폭발이 탱크에 주는 피해. 범위 밖이면 0 */
export function splashDamage(t: ShotTarget, x: number, y: number, radius: number, damage: number): number {
  if (t.dead) return 0;
  const d = Math.hypot(t.x - x, t.y - RULES.TANK.HIT_CENTER_Y - y);
  const edge = Math.max(0, d - RULES.TANK.BODY_RADIUS);
  return edge < radius ? Math.round(damage * (1 - edge / radius)) : 0;
}

/** 착탄점에서 가장 가까운 탱크 (방금 폭발로 죽었을 수 있어 dead도 포함) */
export function nearestTank<T extends ShotTarget>(tanks: readonly T[], x: number, y: number): T {
  const dist = (t: T) => Math.hypot(t.x - x, t.y - RULES.TANK.HIT_CENTER_Y - y);
  return tanks.reduce((a, b) => (dist(b) < dist(a) ? b : a));
}

// 탱크에 직접 맞으면 폭발이 공중이라 땅이 그대로 남아 어색하다.
// 탱크가 맞은 충격으로 땅에 눌린 것처럼 탱크 바닥 모양대로 얕게 판다.
// 포탄이 날아온 반대쪽이 더 깊어서 탱크가 그쪽으로 살짝 기울며 내려앉는다.
// shell: 착탄 순간 포탄 위치·가로 속도
export function digBehindTank(
  terrain: TerrainMask, tanks: readonly ShotTarget[], shell: { x: number; y: number; vx: number }, radius: number,
): EraseOps {
  const T = RULES.TANK;
  const D = T.BLAST_DIG;
  const tank = nearestTank(tanks, shell.x, shell.y);
  // 거의 수직으로 떨어졌으면 맞은 지점이 탱크 중심의 어느 쪽인지로 정한다.
  const dir = Math.abs(shell.vx) > 40 ? Math.sign(shell.vx) : (Math.sign(tank.x - shell.x) || 1);
  // 탱크 몸체 이미지 폭 기준 (궤도는 몸체보다 조금 좁다)
  const half = (BODY_TEXTURE_W * T.SCALE / 2) * D.WIDTH;
  const deep = radius * D.DEPTH;                 // 반대쪽 끝 깊이
  const shallow = deep * D.NEAR;                 // 맞은 쪽 끝 깊이
  return terrain.pressDown(tank.x - half, tank.x + half, tank.y - T.MAX_CLIMB * 4, tank.y + D.MAX_DROP, (x) => {
    const u = (x - tank.x) / half;               // -1 ~ 1
    const far = (u * dir + 1) / 2;               // 맞은 쪽 0 → 반대쪽 1
    // 궤도처럼 양 끝이 둥글게 올라오도록
    const edge = Math.max(0, 1 - Math.abs(u));
    const round = Math.sqrt(Math.min(1, edge / D.ROUND));
    return (shallow + (deep - shallow) * far) * round;
  });
}
