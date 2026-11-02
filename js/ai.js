// CPU 조준: 후보 샷을 시뮬레이션해 상대와 가장 가까운 샷을 고르고 오차를 섞는다.
// 파워 1의 차이가 착탄 지점을 30px 안팎 옮기므로 오차는 작게 둔다.
const AI_ERROR = { ELEVATION: 1.5, POWER: 1.5 };
function planAiShot(tank, enemy, wind, terrain, tanks) {
  const targetX = enemy.x;
  const targetY = enemy.y - CONFIG.TANK.HIT_CENTER_Y;
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

  const usable = CONFIG.WEAPONS
    .map((w, i) => i)
    .filter((i) => tank.stock[i] > 0);
  const weapon = Phaser.Utils.Array.GetRandom(usable);

  return {
    facing,
    weapon,
    elevation: Phaser.Math.Clamp(
      best.elevation + Phaser.Math.FloatBetween(-AI_ERROR.ELEVATION, AI_ERROR.ELEVATION),
      CONFIG.TANK.ELEV_MIN, CONFIG.TANK.ELEV_MAX,
    ),
    power: Phaser.Math.Clamp(
      best.power + Phaser.Math.FloatBetween(-AI_ERROR.POWER, AI_ERROR.POWER), 5, 100,
    ),
  };
}
