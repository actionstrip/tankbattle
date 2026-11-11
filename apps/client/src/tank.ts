// (x, y)는 궤도 바닥 중앙이며, y는 밟고 있는 땅의 첫 픽셀 행이다.
import Phaser from 'phaser';
import { CONFIG } from './config';
import type { Player } from './config';
import type { Muzzle } from './projectile';
import type { GameScene } from './scenes/GameScene';
import { TANK_SHEET, sourceImage } from './tankSlicer';
import type { BarrelInfo } from './tankSlicer';
import type { Terrain } from './terrain';

export class Tank {
  readonly scene: GameScene;
  readonly terrain: Terrain;
  readonly player: Player;
  readonly barrelLength: number;

  x: number;
  y: number;
  facing: number;
  elevation = 45;
  slope = 0;
  targetSlope = 0;
  hp: number = CONFIG.TANK.MAX_HP;
  fuel: number = CONFIG.TANK.FUEL;
  dead = false;
  falling = false;
  fallStartY = 0;
  vy = 0;
  lastPower: number | null = null;
  stock: number[];
  /** 이동량 소진·벽·맵 끝에 막힘 */
  blocked = false;
  private moveRemainder = 0;
  /** 발사 반동 연출 값 (0이면 평상시). kick = 뒤로 밀림·들림, pulse = 크기 출렁임 */
  private fx = { kick: 0, pulse: 0, dir: 1 };

  readonly pivot: { x: number; y: number };
  readonly barrel: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  readonly rig: Phaser.GameObjects.Container;
  readonly root: Phaser.GameObjects.Container;

  constructor(scene: GameScene, terrain: Terrain, player: Player, barrelInfo: BarrelInfo) {
    this.scene = scene;
    this.terrain = terrain;
    this.player = player;
    this.barrelLength = barrelInfo.length * TANK_SHEET.SCALE;

    this.x = player.spawnX;
    this.y = terrain.surfaceY(this.x, 0) ?? 0; // 땅이 없으면 맨 위에서 떨어진다
    this.facing = player.facing;
    this.stock = CONFIG.WEAPONS.map((w) => w.stock);

    const S = TANK_SHEET;
    const name = player.sprite;
    this.pivot = {
      x: (S.PIVOT.x - S.ORIGIN.x) * S.SCALE,
      y: (S.PIVOT.y - S.ORIGIN.y) * S.SCALE,
    };

    const bo = barrelInfo.origin;
    this.barrel = scene.add.image(this.pivot.x, this.pivot.y, 'tank_barrel').setOrigin(bo.x, bo.y);
    const src = sourceImage(scene, `tank_${name}_body_src`);
    this.body = scene.add.image(0, 0, `tank_${name}_body`)
      .setOrigin(S.ORIGIN.x / src.width, S.ORIGIN.y / src.height);
    // 배치 시안대로 포신(고리 부분)이 몸체 위에 그려진다.
    this.rig = scene.add.container(0, 0, [this.body, this.barrel]);
    this.root = scene.add.container(this.x, this.y, [this.rig]).setDepth(CONFIG.DEPTH.TANK);
    this.updateSlope();
    this.syncView(1);
  }

  get rigScale(): number { return CONFIG.TANK.SCALE; }

  groundUnder(x: number, fromY: number): number | null {
    const F = CONFIG.TANK.FEET;
    let best: number | null = null;
    for (const cx of [x - F, x, x + F]) {
      const y = this.terrain.surfaceY(cx, fromY);
      if (y !== null && (best === null || y < best)) best = y;
    }
    return best;
  }

  isSupported(): boolean {
    const F = CONFIG.TANK.FEET;
    const t = this.terrain;
    return t.isSolid(this.x - F, this.y) || t.isSolid(this.x, this.y) || t.isSolid(this.x + F, this.y);
  }

  // 앞쪽 열이 오를 수 있는 높이 위로 차체 높이만큼 비어 있는지 (벽·낮은 천장 판정).
  frontClear(nx: number, dir: number): boolean {
    const T = CONFIG.TANK;
    const front = nx + dir * T.FEET;
    for (let y = this.y - T.MAX_CLIMB - 1; y >= this.y - T.CLEARANCE; y--) {
      if (this.terrain.isSolid(front, y)) return false;
    }
    return true;
  }

  // dir: -1 | 1. 실제로 움직였으면 true.
  move(dir: number, dt: number): boolean {
    const T = CONFIG.TANK;
    this.facing = dir;
    // blocked: 이동량 소진·벽·맵 끝에 막힘 (프레임당 1px 미만이라 이번 프레임에 못 움직인 것과 구분)
    this.blocked = this.fuel <= 0;
    if (this.blocked || this.falling) return false;

    this.moveRemainder += T.MOVE_SPEED * dt;
    let moved = false;
    while (this.moveRemainder >= 1 && this.fuel > 0) {
      this.moveRemainder -= 1;
      const nx = this.x + dir;
      if (nx < 20 || nx > CONFIG.WORLD_W - 20 || !this.frontClear(nx, dir)) {
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

  update(dt: number): void {
    if (this.dead) return;

    if (!this.falling && !this.isSupported()) this.startFall();
    if (this.falling) this.fall(dt);
    if (this.dead) return;

    this.updateSlope();
    this.syncView(Math.min(1, dt * 10));
  }

  private fall(dt: number): void {
    const T = CONFIG.TANK;
    this.vy += CONFIG.PHYSICS.GRAVITY * dt;
    let px = Math.max(1, Math.round(this.vy * dt));
    while (px-- > 0) {
      this.y += 1;
      if (this.y >= CONFIG.WORLD_H) {
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
  private updateSlope(): void {
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
    this.targetSlope = Phaser.Math.Clamp(Math.atan(slope), -0.6, 0.6);
  }

  private syncView(blend: number): void {
    this.slope += (this.targetSlope - this.slope) * blend;
    const R = CONFIG.TANK.RECOIL;
    const { kick, pulse, dir } = this.fx;
    // 반동: 쏜 반대쪽으로 밀리고, 앞쪽이 살짝 들리고, 몸 전체가 커졌다 작아진다.
    this.root.setPosition(this.x - dir * R.PUSH * kick, this.y);
    this.root.setRotation(this.slope - dir * R.TILT * kick);
    this.root.setScale(1 + R.PULSE * pulse);
    this.rig.setScale(this.rigScale * -this.facing, this.rigScale);
    // 포신은 축을 따라 뒤로 쑥 들어갔다 나온다.
    const e = Phaser.Math.DegToRad(this.elevation);
    const back = (R.BARREL * kick) / this.rigScale;
    this.barrel.setPosition(this.pivot.x + Math.cos(e) * back, this.pivot.y + Math.sin(e) * back);
    this.barrel.setRotation(e);
  }

  // 발사 반동. strength는 무기별 배율 (강력탄은 더 세게).
  recoil(dirX: number, strength = 1): void {
    const R = CONFIG.TANK.RECOIL;
    const fx = this.fx;
    this.scene.tweens.killTweensOf(fx);
    fx.dir = Math.sign(dirX) || this.facing;
    fx.kick = strength;
    fx.pulse = strength;
    this.scene.tweens.add({ targets: fx, kick: 0, duration: R.KICK_MS, ease: 'Quad.easeOut' });
    this.scene.tweens.add({ targets: fx, pulse: 0, duration: R.PULSE_MS, ease: 'Elastic.easeOut', easeParams: [1, 0.35] });
  }

  // 차체 경사를 반영한 총구 위치와 발사 방향.
  muzzle(elevation = this.elevation): Muzzle {
    const e = Phaser.Math.DegToRad(elevation);
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
    this.scene.onTankDamaged(this, amount);
    this.body.setTint(0xff7777);
    this.barrel.setTint(0xff7777);
    this.scene.time.delayedCall(180, () => {
      if (this.body.active) this.body.setTint(0xffffff);
      if (this.barrel.active) this.barrel.setTint(0xffffff);
    });
    if (this.hp === 0) this.die();
  }

  die(): void {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.falling = false;
    this.root.setVisible(false);
    this.scene.onTankDestroyed(this);
  }
}
