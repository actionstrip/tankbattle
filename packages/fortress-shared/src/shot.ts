// 한 번의 발사(1발 또는 3연발)를 끝까지 계산한다. 서버 판정과 로컬 게임이 같은 코드를 쓴다.
// 결과(착탄·구덩이·피해)는 그대로 클라이언트에 보내 연출에 쓴다.
import { RULES } from './config';
import type { Weapon } from './config';
import { blastOf, digBehindTank, splashDamage } from './combat';
import { makeShell, shellContact, stepShell } from './projectile';
import type { HitKind, Muzzle, ShellState } from './projectile';
import type { Rng } from './rng';
import type { TankBody } from './tankBody';
import type { CarveResult, EraseOps, TerrainMask } from './terrainMask';

/** 포탄 하나가 맞았을 때 일어난 일 */
export interface Impact {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hit: HitKind;
  /** 폭발 반경 (화면 밖으로 나갔으면 0) */
  radius: number;
  /** 착탄 속도에 따른 세기 배율 (연출용) */
  scale: number;
  carve: CarveResult | null;
  /** 탱크 직격 시 탱크 아래가 눌린 자국 */
  dig: EraseOps | null;
  /** 탱크 순서대로 입힌 피해 (0이면 안 맞음) */
  damages: number[];
}

export interface ShellImpact extends Impact {
  /** 몇 번째 포탄인지 (발사 순서) */
  shell: number;
  /** 발사 후 몇 스텝(RULES.PHYSICS.STEP) 만에 맞았는지 */
  steps: number;
}

export interface VolleyResult {
  weapon: number;
  power: number;
  elevation: number;
  facing: number;
  wind: number;
  muzzles: Muzzle[];
  /** 맞은 순서대로 */
  impacts: ShellImpact[];
  /** 마지막 포탄이 끝날 때까지 걸린 스텝 수 */
  steps: number;
}

/**
 * 착탄 처리: 폭발 세기 → 땅 파기 → 피해 → (직격이면) 탱크 아래 눌림.
 * terrain·tanks를 실제로 바꾼다. 클라이언트 Terrain/Tank는 이 호출 중에 그림·연출도 한다.
 */
export function resolveImpact(
  terrain: TerrainMask, tanks: readonly TankBody[], shell: ShellState, hit: HitKind, weapon: Weapon, rng: Rng,
): Impact {
  const base = { x: shell.x, y: shell.y, vx: shell.vx, vy: shell.vy, hit };
  if (hit === 'out') return { ...base, radius: 0, scale: 0, carve: null, dig: null, damages: tanks.map(() => 0) };

  const { scale, radius, damage } = blastOf(weapon, Math.hypot(shell.vx, shell.vy));
  const carve = terrain.carve(shell.x, shell.y, radius, rng);
  const damages = tanks.map((t) => splashDamage(t, shell.x, shell.y, radius, damage));
  tanks.forEach((t, i) => t.damage(damages[i]));
  const dig = hit === 'tank' ? digBehindTank(terrain, tanks, shell, radius) : null;
  return { ...base, radius, scale, carve, dig, damages };
}

/** 3연발이면 [-각, 0, +각], 아니면 [0] */
export function shellOffsets(weapon: Weapon): number[] {
  return weapon.shells === 3 ? [-RULES.TRIPLE_SPREAD, 0, RULES.TRIPLE_SPREAD] : [0];
}

/**
 * 발사부터 마지막 포탄이 끝날 때까지 계산한다 (서버 판정용).
 * 클라이언트 GameScene.updateShells와 같은 순서로 진행한다: 매 스텝 뒤에서부터 포탄을 움직이고 맞으면 바로 처리.
 */
export function fireVolley(
  shooter: TankBody, tanks: readonly TankBody[], terrain: TerrainMask,
  weaponIndex: number, power: number, wind: number, rng: Rng,
): VolleyResult {
  const weapon = RULES.WEAPONS[weaponIndex];
  shooter.stock[weaponIndex] -= 1;
  shooter.lastPower = power;

  const muzzles = shellOffsets(weapon).map((o) => shooter.muzzle(shooter.elevation + o));
  const shells = muzzles.map((m, id) => ({ ...makeShell(m, power), id }));
  const impacts: ShellImpact[] = [];
  let steps = 0;
  while (shells.length) {
    steps++;
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i];
      stepShell(s, wind);
      const hit = shellContact(s, terrain, tanks, shooter);
      if (!hit) continue;
      shells.splice(i, 1);
      impacts.push({ shell: s.id, steps, ...resolveImpact(terrain, tanks, s, hit, weapon, rng) });
    }
  }
  return {
    weapon: weaponIndex, power, elevation: shooter.elevation, facing: shooter.facing, wind, muzzles, impacts, steps,
  };
}

/**
 * 땅이 파인 뒤 탱크들이 다 떨어질 때까지 진행한다 (낙하 피해·추락 포함). 걸린 시간(초)을 돌려준다.
 */
export function settleTanks(tanks: readonly TankBody[], dt = 1 / 60, maxSeconds = 15): number {
  let t = 0;
  // 첫 스텝은 무조건 (받침이 사라졌는지 확인)
  do {
    for (const tank of tanks) tank.step(dt);
    t += dt;
  } while (tanks.some((tank) => tank.falling) && t < maxSeconds);
  return t;
}
