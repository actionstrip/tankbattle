// 탄 궤적 계산. 게임 진행과 CPU 조준이 같은 코드를 써서 예측이 어긋나지 않는다.
import { CONFIG } from './config';
import type { Tank } from './tank';
import type { Terrain } from './terrain';

export interface Muzzle { x: number; y: number; dirX: number; dirY: number }

export interface ShellState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export type HitKind = 'tank' | 'ground' | 'out';

export function makeShell(muzzle: Muzzle, power: number): ShellState {
  const speed = power * CONFIG.PHYSICS.POWER_TO_SPEED;
  return {
    x: muzzle.x,
    y: muzzle.y,
    vx: muzzle.dirX * speed,
    vy: muzzle.dirY * speed,
    age: 0,
  };
}

export function stepShell(s: ShellState, wind: number): void {
  const P = CONFIG.PHYSICS;
  s.vx += wind * P.WIND_ACCEL * P.STEP;
  s.vy += P.GRAVITY * P.STEP;
  s.x += s.vx * P.STEP;
  s.y += s.vy * P.STEP;
  s.age += P.STEP;
}

export function shellContact(
  s: ShellState, terrain: Terrain, tanks: readonly Tank[], owner: Tank | null,
): HitKind | null {
  const T = CONFIG.TANK;
  for (const t of tanks) {
    if (t.dead) continue;
    if (t === owner && s.age < 0.4) continue; // 자기 포구에서 터지는 것을 방지
    const nx = (s.x - t.x) / T.HIT_RX;
    const ny = (s.y - (t.y - T.HIT_CENTER_Y)) / T.HIT_RY;
    if (nx * nx + ny * ny <= 1) return 'tank';
  }
  if (terrain.isSolid(s.x, s.y)) return 'ground';
  // 위쪽(y < 0)으로는 계속 날아갈 수 있다.
  if (s.x < -50 || s.x > CONFIG.WORLD_W + 50 || s.y > CONFIG.WORLD_H) return 'out';
  if (s.age > CONFIG.PHYSICS.MAX_FLIGHT) return 'out';
  return null;
}

// 지형을 바꾸지 않고 착탄 지점만 구한다.
export function simulateShot(
  muzzle: Muzzle, power: number, wind: number, terrain: Terrain, tanks: readonly Tank[], owner: Tank,
): { x: number; y: number; hit: HitKind } {
  const s = makeShell(muzzle, power);
  let hit: HitKind | null = null;
  while (!hit) {
    stepShell(s, wind);
    hit = shellContact(s, terrain, tanks, owner);
  }
  return { x: s.x, y: s.y, hit };
}
