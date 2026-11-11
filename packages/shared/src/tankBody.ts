// 탱크 상태와 움직임 (그리기 없음). 클라이언트 Tank가 이것을 상속해 스프라이트를 붙인다.
// (x, y)는 궤도 바닥 중앙이며, y는 밟고 있는 땅의 첫 픽셀 행이다.
import { BARREL_LENGTH, RULES, TANK_SHEET } from './config';
import type { Player } from './config';
import { clamp, degToRad } from './math';
import type { Muzzle } from './projectile';
import type { TerrainMask } from './terrainMask';

export class TankBody {
  readonly terrain: TerrainMask;
  readonly player: Player;
  /** 회전축~총구 거리 (텍스처 좌표, 표시 배율 적용 전) */
  readonly barrelLength: number;
  /** 궤도 바닥 중앙 기준 포신 회전축 (텍스처 좌표, 표시 배율 적용 전) */
  readonly pivot: { x: number; y: number };

  x: number;
  y: number;
  facing: number;
  elevation = 45;
  /** 차체 기울기 (rad). 판정(포구 위치)에 쓰인다. 클라이언트는 targetSlope로 부드럽게 따라간다 */
  slope = 0;
  targetSlope = 0;
  hp: number = RULES.TANK.MAX_HP;
  fuel: number = RULES.TANK.FUEL;
  dead = false;
  falling = false;
  fallStartY = 0;
  vy = 0;
  lastPower: number | null = null;
  stock: number[];
  /** 이동량 소진·벽·맵 끝에 막힘 */
  blocked = false;
  private moveRemainder = 0;

  constructor(terrain: TerrainMask, player: Player) {
    this.terrain = terrain;
    this.player = player;
    const S = TANK_SHEET;
    this.barrelLength = BARREL_LENGTH * S.SCALE;
    this.pivot = {
      x: (S.PIVOT.x - S.ORIGIN.x) * S.SCALE,
      y: (S.PIVOT.y - S.ORIGIN.y) * S.SCALE,
    };

    this.x = player.spawnX;
    this.y = terrain.surfaceY(this.x, 0) ?? 0; // 땅이 없으면 맨 위에서 떨어진다
    this.facing = player.facing;
    this.stock = RULES.WEAPONS.map((w) => w.stock);
    this.updateSlope();
    this.slope = this.targetSlope;
  }

  get rigScale(): number { return RULES.TANK.SCALE; }

  groundUnder(x: number, fromY: number): number | null {
    const F = RULES.TANK.FEET;
    let best: number | null = null;
    for (const cx of [x - F, x, x + F]) {
      const y = this.terrain.surfaceY(cx, fromY);
      if (y !== null && (best === null || y < best)) best = y;
    }
    return best;
  }

  isSupported(): boolean {
    const F = RULES.TANK.FEET;
    const t = this.terrain;
    return t.isSolid(this.x - F, this.y) || t.isSolid(this.x, this.y) || t.isSolid(this.x + F, this.y);
  }

  // 앞쪽 열이 오를 수 있는 높이 위로 차체 높이만큼 비어 있는지 (벽·낮은 천장 판정).
  frontClear(nx: number, dir: number): boolean {
    const T = RULES.TANK;
    const front = nx + dir * T.FEET;
    for (let y = this.y - T.MAX_CLIMB - 1; y >= this.y - T.CLEARANCE; y--) {
      if (this.terrain.isSolid(front, y)) return false;
    }
    return true;
  }

  // dir: -1 | 1. 실제로 움직였으면 true.
  move(dir: number, dt: number): boolean {
    const T = RULES.TANK;
    this.facing = dir;
    // blocked: 이동량 소진·벽·맵 끝에 막힘 (프레임당 1px 미만이라 이번 프레임에 못 움직인 것과 구분)
    this.blocked = this.fuel <= 0;
    if (this.blocked || this.falling) return false;

    this.moveRemainder += T.MOVE_SPEED * dt;
    let moved = false;
    while (this.moveRemainder >= 1 && this.fuel > 0) {
      this.moveRemainder -= 1;
      const nx = this.x + dir;
      if (nx < 20 || nx > RULES.WORLD_W - 20 || !this.frontClear(nx, dir)) {
        this.blocked = true;
        break;
      }

      const gy = this.groundUnder(nx, this.y - T.MAX_CLIMB);
      this.x = nx;
      this.fuel -= 1;
      moved = true;
      if (gy === null || gy > this.y + 3) {
        this.startFall();
        break;
      }
      this.y = gy;
    }
    if (this.blocked) this.moveRemainder = 0;
    return moved;
  }

  startFall(): void {
    if (this.falling) return;
    this.falling = true;
    this.fallStartY = this.y;
    this.vy = 0;
  }

  // 떨어진 땅에 묻혔을 때 위로 밀어 올린다.
  unstick(): void {
    if (!this.terrain.isSolid(this.x, this.y - 1)) return;
    while (this.y > 0 && this.terrain.isSolid(this.x, this.y - 1)) this.y--;
    this.falling = false;
    this.vy = 0;
  }

  /** 낙하·기울기 갱신. 그리기는 하지 않는다 */
  step(dt: number): void {
    if (this.dead) return;

    if (!this.falling && !this.isSupported()) this.startFall();
    if (this.falling) this.fall(dt);
    if (this.dead) return;

    this.updateSlope();
  }

  private fall(dt: number): void {
    const T = RULES.TANK;
    this.vy += RULES.PHYSICS.GRAVITY * dt;
    let px = Math.max(1, Math.round(this.vy * dt));
    while (px-- > 0) {
      this.y += 1;
      if (this.y >= RULES.WORLD_H) {
        this.die();
        return;
      }
      if (this.isSupported()) {
        this.falling = false;
        const dist = this.y - this.fallStartY;
        if (dist > T.SAFE_FALL) {
          this.damage(Math.round((dist - T.SAFE_FALL) * T.FALL_DAMAGE));
        }
        return;
      }
    }
  }

  // 궤도 아래 5개 지점 높이의 최소제곱 기울기. 파인 땅 위에서도 덜 떨린다.
  protected updateSlope(): void {
    const from = this.y - 30;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    for (const o of [-28, -14, 0, 14, 28]) {
      const gy = this.terrain.surfaceY(this.x + o, from);
      if (gy === null || gy > this.y + 30) continue;
      n++;
      sx += o;
      sy += gy;
      sxy += o * gy;
      sxx += o * o;
    }
    const denom = n * sxx - sx * sx;
    const slope = n >= 2 && denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
    this.targetSlope = clamp(Math.atan(slope), -0.6, 0.6);
  }

  // 차체 경사를 반영한 총구 위치와 발사 방향.
  muzzle(elevation = this.elevation): Muzzle {
    const e = degToRad(elevation);
    const sx = this.rigScale * -this.facing;
    const sy = this.rigScale;
    const dx = -Math.cos(e);
    const dy = -Math.sin(e);
    const lx = (this.pivot.x + dx * this.barrelLength) * sx;
    const ly = (this.pivot.y + dy * this.barrelLength) * sy;
    const cos = Math.cos(this.slope);
    const sin = Math.sin(this.slope);
    const dirLen = Math.hypot(dx * sx, dy * sy);
    const ux = (dx * sx) / dirLen;
    const uy = (dy * sy) / dirLen;
    return {
      x: this.x + lx * cos - ly * sin,
      y: this.y + lx * sin + ly * cos,
      dirX: ux * cos - uy * sin,
      dirY: ux * sin + uy * cos,
    };
  }

  damage(amount: number): void {
    if (this.dead || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.onDamaged(amount);
    if (this.hp === 0) this.die();
  }

  die(): void {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.falling = false;
    this.onDied();
  }

  /** 피해를 입은 직후 (hp는 이미 줄어 있음). 클라이언트가 연출을 붙인다 */
  protected onDamaged(_amount: number): void {}

  /** 격파 직후. 클라이언트가 연출을 붙인다 */
  protected onDied(): void {}
}
