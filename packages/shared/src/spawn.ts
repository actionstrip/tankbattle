import { RULES, sideOf } from './config';
import type { PlayerDef } from './config';
import type { Rng } from './rng';
import type { TerrainMask } from './terrainMask';

// 탱크마다 서로 다른 발판을 무작위로 골라 그 위 아무 곳에 놓는다 (한 발판에 한 대).
// 발판이 탱크 수보다 적으면 남은 탱크는 이미 쓴 발판 중 넓은 곳에 간격을 두고 놓는다.
// players의 spawnX·facing을 바꾼다.
export function randomizeSpawns(players: PlayerDef[], terrain: TerrainMask, rng: Rng): void {
  const S = RULES.SPAWN;
  const plats = rng.shuffle(terrain.findPlatforms(S.MIN_PLATFORM));
  if (plats.length === 0) return; // 발판을 못 찾으면 설정값(spawnX) 그대로
  const used: number[][] = plats.map(() => []);
  players.forEach((p, i) => {
    let k = i < plats.length ? i : -1;
    if (k < 0) {
      // 남는 탱크: 가장 넓은 발판에 다른 탱크와 MIN_GAP 이상 떨어진 자리
      k = plats.reduce((b, q, j) => ((q.x1 - q.x0) > (plats[b].x1 - plats[b].x0) ? j : b), 0);
    }
    const { x0, x1 } = plats[k];
    const lo = x0 + S.EDGE;
    const hi = Math.max(lo, x1 - S.EDGE);
    let x = rng.int(lo, hi);
    for (let tries = 0; tries < 30 && used[k].some((u) => Math.abs(u - x) < S.MIN_GAP); tries++) {
      x = rng.int(lo, hi);
    }
    used[k].push(x);
    p.spawnX = x;
  });
  // 가장 가까운 적을 바라보게 한다.
  for (const p of players) {
    const foes = players.filter((q) => sideOf(q) !== sideOf(p));
    if (!foes.length) continue;
    const near = foes.reduce((a, b) => (Math.abs(b.spawnX - p.spawnX) < Math.abs(a.spawnX - p.spawnX) ? b : a));
    p.facing = near.spawnX >= p.spawnX ? 1 : -1;
  }
}
