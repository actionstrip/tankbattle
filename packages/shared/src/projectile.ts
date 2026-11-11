// 탄 궤적 계산. 게임 진행·CPU 조준·서버 판정이 같은 코드를 써서 예측이 어긋나지 않는다.
import { RULES } from './config';

export interface Muzzle { x: number; y: number; dirX: number; dirY: number }

export interface ShellState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export type HitKind = 'tank' | 'ground' | 'out';

/** 탄이 맞을 수 있는 탱크 (x, y = 궤도 바닥 중앙) */
export interface ShotTarget { x: number; y: number; dead: boolean }

/** 땅 판정 */
export interface SolidMap { isSolid(x: number, y: number): boolean }

export function makeShell(muzzle: Muzzle, power: number): ShellState {
  const speed = power * RULES.PHYSICS.POWER_TO_SPEED;
  return {
    x: muzzle.x,
    y: muzzle.y,
    vx: muzzle.dirX * speed,
    vy: muzzle.dirY * speed,
    age: 0,
  };
}

export function stepShell(s: ShellState, wind: number): void {
  const P = RULES.PHYSICS;
  s.vx += wind * P.WIND_ACCEL * P.STEP;
  s.vy += P.GRAVITY * P.STEP;
  s.x += s.vx * P.STEP;
  s.y += s.vy * P.STEP;
  s.age += P.STEP;
}

export function shellContact(
  s: ShellState, terrain: SolidMap, tanks: readonly ShotTarget[], owner: ShotTarget | null,
): HitKind | null {
  const T = RULES.TANK;
  for (const t of tanks) {
    if (t.dead) continue;
    if (t === owner && s.age < 0.4) continue; // 자기 포구에서 터지는 것을 방지
    const nx = (s.x - t.x) / T.HIT_RX;
    const ny = (s.y - (t.y - T.HIT_CENTER_Y)) / T.HIT_RY;
    if (nx * nx + ny * ny <= 1) return 'tank';
  }
  if (terrain.isSolid(s.x, s.y)) return 'ground';
  // 위쪽(y < 0)으로는 계속 날아갈 수 있다.
  if (s.x < -50 || s.x > RULES.WORLD_W + 50 || s.y > RULES.WORLD_H) return 'out';
  if (s.age > RULES.PHYSICS.MAX_FLIGHT) return 'out';
  return null;
}

// 지형을 바꾸지 않고 착탄 지점만 구한다.
export function simulateShot(
  muzzle: Muzzle, power: number, wind: number, terrain: SolidMap, tanks: readonly ShotTarget[], owner: ShotTarget,
): { x: number; y: number; hit: HitKind } {
  const s = makeShell(muzzle, power);
  let hit: HitKind | null = null;
  while (!hit) {
    stepShell(s, wind);
    hit = shellContact(s, terrain, tanks, owner);
  }
  return { x: s.x, y: s.y, hit };
}
