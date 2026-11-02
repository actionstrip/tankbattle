// (x, y)는 궤도 바닥 중앙이며, y는 밟고 있는 땅의 첫 픽셀 행이다.
class Tank {
  constructor(scene, terrain, player, barrelInfo) {
    this.scene = scene;
    this.terrain = terrain;
    this.player = player;
    this.barrelLength = barrelInfo.length * TANK_SHEET.SCALE;

    this.x = player.spawnX;
    this.y = terrain.surfaceY(this.x, 0);
    this.facing = player.facing;
    this.elevation = 45;
    this.slope = 0;
    this.targetSlope = 0;
    this.hp = CONFIG.TANK.MAX_HP;
    this.fuel = CONFIG.TANK.FUEL;
    this.dead = false;
    this.falling = false;
    this.fallStartY = 0;
    this.vy = 0;
    this.lastPower = null;
    this.stock = CONFIG.WEAPONS.map((w) => w.stock);
    this.moveRemainder = 0;

    const S = TANK_SHEET;
    const name = player.sprite;
    this.pivot = {
      x: (S.PIVOT.x - S.ORIGIN.x) * S.SCALE,
      y: (S.PIVOT.y - S.ORIGIN.y) * S.SCALE,
    };

    this.barrel = scene.add.image(this.pivot.x, this.pivot.y, `tank_${name}_barrel`).setOrigin(1, 0.5);
    this.body = scene.add.image(0, 0, `tank_${name}_body`)
      .setOrigin(S.ORIGIN.x / S.CELL_W, S.ORIGIN.y / S.CELL_H);
    this.rig = scene.add.container(0, 0, [this.barrel, this.body]);
    this.root = scene.add.container(this.x, this.y, [this.rig]).setDepth(CONFIG.DEPTH.TANK);
    this.updateSlope();
    this.syncView(1);
  }

  get rigScale() { return CONFIG.TANK.SCALE; }

  groundUnder(x, fromY) {
    const F = CONFIG.TANK.FEET;
    let best = null;
    for (const cx of [x - F, x, x + F]) {
      const y = this.terrain.surfaceY(cx, fromY);
      if (y !== null && (best === null || y < best)) best = y;
    }
    return best;
  }

  isSupported() {
    const F = CONFIG.TANK.FEET;
    const t = this.terrain;
    return t.isSolid(this.x - F, this.y) || t.isSolid(this.x, this.y) || t.isSolid(this.x + F, this.y);
  }

  // 앞쪽 열이 오를 수 있는 높이 위로 차체 높이만큼 비어 있는지 (벽·낮은 천장 판정).
  frontClear(nx, dir) {
    const T = CONFIG.TANK;
    const front = nx + dir * T.FEET;
    for (let y = this.y - T.MAX_CLIMB - 1; y >= this.y - T.CLEARANCE; y--) {
      if (this.terrain.isSolid(front, y)) return false;
    }
    return true;
  }

  // dir: -1 | 1. 실제로 움직였으면 true.
  move(dir, dt) {
    const T = CONFIG.TANK;
    this.facing = dir;
    if (this.fuel <= 0 || this.falling) return false;

    this.moveRemainder += T.MOVE_SPEED * dt;
    let moved = false;
    while (this.moveRemainder >= 1 && this.fuel > 0) {
      this.moveRemainder -= 1;
      const nx = this.x + dir;
      if (nx < 20 || nx > CONFIG.WORLD_W - 20) break;
      if (!this.frontClear(nx, dir)) break;

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
    if (!moved) this.moveRemainder = 0;
    return moved;
  }

  startFall() {
    if (this.falling) return;
    this.falling = true;
    this.fallStartY = this.y;
    this.vy = 0;
  }

  // 떨어진 땅에 묻혔을 때 위로 밀어 올린다.
  unstick() {
    if (!this.terrain.isSolid(this.x, this.y - 1)) return;
    while (this.y > 0 && this.terrain.isSolid(this.x, this.y - 1)) this.y--;
    this.falling = false;
    this.vy = 0;
  }

  update(dt) {
    if (this.dead) return;

    if (!this.falling && !this.isSupported()) this.startFall();
    if (this.falling) this.fall(dt);
    if (this.dead) return;

    this.updateSlope();
    this.syncView(Math.min(1, dt * 10));
  }

  fall(dt) {
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
  updateSlope() {
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

  syncView(blend) {
    this.slope += (this.targetSlope - this.slope) * blend;
    this.root.setPosition(this.x, this.y);
    this.root.setRotation(this.slope);
    this.rig.setScale(this.rigScale * -this.facing, this.rigScale);
    this.barrel.setRotation(Phaser.Math.DegToRad(this.elevation));
  }

  // 차체 경사를 반영한 총구 위치와 발사 방향.
  muzzle(elevation = this.elevation) {
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

  damage(amount) {
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

  die() {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.falling = false;
    this.root.setVisible(false);
    this.scene.onTankDestroyed(this);
  }
}
