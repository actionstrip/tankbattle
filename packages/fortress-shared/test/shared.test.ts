import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  RULES, Rng, TankBody, blastOf, createStageMask, digBehindTank, fireVolley, loadStageSolid, planAiShot, randomizeSpawns,
  settleTanks, simulateShot, splashDamage,
} from '../src/index';
import type { Player } from '../src/index';

const GROUND_PNG = new URL('../../../apps/fortress/public/images/background/stage1_ground.png', import.meta.url);

describe('지형 마스크', () => {
  it('미리 만든 마스크가 땅 이미지의 알파값과 같다 (그림을 바꾸고 npm run build:mask 를 안 했으면 실패)', () => {
    const png = PNG.sync.read(readFileSync(GROUND_PNG));
    const { w, h, solid } = loadStageSolid();
    expect([png.width, png.height]).toEqual([w, h]);
    let diff = 0;
    for (let i = 0; i < w * h; i++) {
      if ((png.data[i * 4 + 3] >= RULES.TERRAIN.ALPHA_SOLID ? 1 : 0) !== solid[i]) diff++;
    }
    expect(diff).toBe(0);
  });

  it('같은 시드로 파면 같은 모양이 된다', () => {
    const a = createStageMask();
    const b = createStageMask();
    const ra = new Rng(42);
    const rb = new Rng(42);
    for (const [x, y, r] of [[600, 520, 45], [1280, 560, 75], [1900, 480, 30]]) {
      a.carve(x, y, r, ra);
      b.carve(x, y, r, rb);
    }
    expect(Buffer.from(a.solid).equals(Buffer.from(b.solid))).toBe(true);
    expect(a.version).toBe(3);
  });

  it('잡티를 지우고 떠 있는 섬의 고정점을 찾는다', () => {
    const m = createStageMask();
    expect(m.findPlatforms(RULES.SPAWN.MIN_PLATFORM).length).toBeGreaterThan(0);
    expect(m.anchors.every((a) => m.isSolid(a.x, a.y))).toBe(true);
  });
});

describe('난수', () => {
  it('같은 시드면 같은 수열', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it('int는 양 끝을 포함한다', () => {
    const r = new Rng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(-2, 2));
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2].sort());
  });
});

// 같은 시드로 한 판을 처음부터 진행하면 결과가 같아야 서버 판정과 클라 연출이 어긋나지 않는다.
function playRound(seed: number) {
  const rng = new Rng(seed);
  const terrain = createStageMask();
  const players: Player[] = RULES.TEAM_PLAYERS.map((p) => ({ ...p, ai: true }));
  randomizeSpawns(players, terrain, rng);
  const tanks = players.map((p) => new TankBody(terrain, p));
  const log: number[] = [];
  for (let turn = 0; turn < 6; turn++) {
    const tank = tanks[turn % tanks.length];
    if (tank.dead) continue;
    const wind = rng.int(-RULES.PHYSICS.WIND_MAX, RULES.PHYSICS.WIND_MAX);
    const enemy = tanks.find((t) => !t.dead && t.player.team !== tank.player.team);
    if (!enemy) break;
    const plan = planAiShot(tank, enemy, wind, terrain, tanks, rng);
    tank.facing = plan.facing;
    tank.elevation = plan.elevation;
    const hit = simulateShot(tank.muzzle(), plan.power, wind, terrain, tanks, tank);
    if (hit.hit !== 'out') {
      const { radius, damage } = blastOf(RULES.WEAPONS[plan.weapon]);
      terrain.carve(hit.x, hit.y, radius, rng);
      for (const t of tanks) t.damage(splashDamage(t, hit.x, hit.y, radius, damage));
      if (hit.hit === 'tank') digBehindTank(terrain, tanks, { x: hit.x, y: hit.y, vx: 0 }, radius);
    }
    for (let i = 0; i < 240; i++) for (const t of tanks) t.step(1 / 60); // 낙하 정리
    log.push(wind, Math.round(hit.x * 1000), Math.round(hit.y * 1000), ...tanks.map((t) => t.hp));
  }
  return { log, tanks: tanks.map((t) => [t.x, t.y, t.hp, t.dead]), solid: Buffer.from(terrain.solid) };
}

describe('서버 판정 결과 재생', () => {
  it('fireVolley 결과(구덩이·자국)만 다른 마스크에 적용해도 지형이 같아진다', () => {
    const rng = new Rng(99);
    const server = createStageMask();
    const client = createStageMask();
    const players: Player[] = RULES.TEAM_PLAYERS.map((p) => ({ ...p, ai: false }));
    randomizeSpawns(players, server, rng);
    const tanks = players.map((p) => new TankBody(server, p));
    let impacts = 0;
    for (let turn = 0; turn < 8; turn++) {
      const shooter = tanks[turn % tanks.length];
      if (shooter.dead) continue;
      shooter.elevation = 30 + turn * 6;
      shooter.facing = turn % 2 ? -1 : 1;
      const v = fireVolley(shooter, tanks, server, turn % 3 === 2 ? 2 : 0, 55 + turn * 4, rng.int(-10, 10), rng);
      settleTanks(tanks);
      for (const imp of v.impacts) {
        if (imp.carve) client.applyCarve(imp.carve);
        if (imp.dig) client.applyErase(imp.dig);
        impacts++;
      }
    }
    expect(impacts).toBeGreaterThan(0);
    expect(Buffer.from(client.solid).equals(Buffer.from(server.solid))).toBe(true);
  });
});

describe('한 판 재현', () => {
  it('같은 시드면 바람·착탄·피해·지형이 모두 같다', () => {
    const a = playRound(1234);
    const b = playRound(1234);
    expect(a.log).toEqual(b.log);
    expect(a.tanks).toEqual(b.tanks);
    expect(a.solid.equals(b.solid)).toBe(true);
  });
});
