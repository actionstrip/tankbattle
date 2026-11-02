class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.mode = data.mode || 'cpu';
  }

  create() {
    addFixedBackground(this);
    this.terrain = new Terrain(this);
    const barrelInfo = this.registry.get('barrelInfo');
    this.tanks = CONFIG.PLAYERS.map((p) => new Tank(this, this.terrain, p, barrelInfo));
    this.hud = new Hud(this, this.tanks, this.terrain);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, CONFIG.WORLD_W, CONFIG.WORLD_H);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.weaponKeys = [
      this.input.keyboard.addKey('ONE'),
      this.input.keyboard.addKey('TWO'),
      this.input.keyboard.addKey('THREE'),
    ];

    this.state = 'idle';
    this.activeIndex = 1; // startTurn이 먼저 넘기므로 파랑부터 시작
    this.shells = [];
    this.chunks = [];
    this.followedShell = null;
    this.stepAcc = 0;
    this.wind = 0;
    this.power = 0;
    this.weaponIndex = 0;
    this.timeLeft = CONFIG.TURN_SECONDS;
    this.resolveWait = 0;
    this.ai = null;

    this.debug = new URLSearchParams(location.search).has('debug');
    if (this.debug) this.setupDebug();

    cam.centerOn(this.tanks[0].x, CONFIG.WORLD_H / 2);
    this.startTurn();
  }

  get active() { return this.tanks[this.activeIndex]; }

  get isAiTurn() { return this.mode === 'cpu' && this.activeIndex === 1; }

  // ---- 카메라 ----

  focusTank(tank) {
    const cam = this.cameras.main;
    const half = CONFIG.GAME_W / 2;
    const x = Phaser.Math.Clamp(tank.x, half, CONFIG.WORLD_W - half);
    cam.stopFollow();
    cam.pan(x, CONFIG.WORLD_H / 2, 700, 'Sine.easeInOut', true, (c, progress) => {
      if (progress === 1 && this.active === tank && this.state === 'aiming') {
        cam.startFollow(tank.root, false, 0.15, 0.15);
      }
    });
  }

  followShell(shell) {
    this.followedShell = shell;
    const cam = this.cameras.main;
    cam.stopFollow();
    if (shell) cam.startFollow(shell.sprite, false, 0.1, 0.1);
  }

  // ---- 턴 ----

  startTurn() {
    this.activeIndex = 1 - this.activeIndex;
    const tank = this.active;
    tank.fuel = CONFIG.TANK.FUEL;
    const max = CONFIG.PHYSICS.WIND_MAX;
    this.wind = Phaser.Math.Between(-max, max);
    this.timeLeft = CONFIG.TURN_SECONDS;
    this.power = 0;
    this.weaponIndex = 0;
    this.state = 'aiming';
    this.ai = this.isAiTurn ? { think: 0.9, plan: null } : null;
    this.hud.showBanner(`${tank.player.name} 차례`);
    this.focusTank(tank);
  }

  update(time, delta) {
    const dt = Math.min(delta, 50) / 1000;
    for (const c of this.chunks) c.update(dt, this.tanks);
    this.chunks = this.chunks.filter((c) => !c.done);
    for (const t of this.tanks) t.update(dt);

    // 조준 중에 맵 아래로 떨어지는 등으로 탱크가 죽으면 쏘지 않고 바로 정산한다.
    if ((this.state === 'aiming' || this.state === 'charging') && this.tanks.some((t) => t.dead)) {
      this.beginResolve();
    }

    switch (this.state) {
      case 'aiming': this.updateAiming(dt); break;
      case 'charging': this.updateCharging(dt); break;
      case 'flying': this.updateShells(dt); break;
      case 'resolving': this.updateResolving(dt); break;
      default: break;
    }

    this.hud.update({
      active: this.state === 'gameover' ? null : this.active,
      wind: this.wind,
      timeLeft: this.timeLeft,
      power: this.power,
      weaponIndex: this.weaponIndex,
      isAi: this.isAiTurn,
      time,
      shell: this.followedShell,
      chunks: this.chunks,
    });
    if (this.debug) this.updateDebug();
  }

  updateAiming(dt) {
    const tank = this.active;
    if (this.ai) { this.updateAi(dt); return; }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.beginResolve(); return; }

    if (this.cursors.left.isDown) tank.move(-1, dt);
    else if (this.cursors.right.isDown) tank.move(1, dt);

    const T = CONFIG.TANK;
    if (this.cursors.up.isDown) tank.elevation += T.AIM_SPEED * dt;
    if (this.cursors.down.isDown) tank.elevation -= T.AIM_SPEED * dt;
    tank.elevation = Phaser.Math.Clamp(tank.elevation, T.ELEV_MIN, T.ELEV_MAX);

    this.weaponKeys.forEach((key, i) => {
      if (Phaser.Input.Keyboard.JustDown(key) && tank.stock[i] > 0) this.weaponIndex = i;
    });

    if (Phaser.Input.Keyboard.JustDown(this.cursors.space) && !tank.falling) {
      this.power = 0;
      this.state = 'charging';
    }
  }

  updateAi(dt) {
    const tank = this.active;
    const ai = this.ai;
    if (ai.think > 0) { ai.think -= dt; return; }
    if (tank.falling) return;

    if (!ai.plan) {
      const enemy = this.tanks[1 - this.activeIndex];
      ai.plan = planAiShot(tank, enemy, this.wind, this.terrain, this.tanks);
      tank.facing = ai.plan.facing;
      this.weaponIndex = ai.plan.weapon;
    }

    const diff = ai.plan.elevation - tank.elevation;
    const stepDeg = CONFIG.TANK.AIM_SPEED * dt;
    if (Math.abs(diff) > stepDeg) {
      tank.elevation += Math.sign(diff) * stepDeg;
      return;
    }
    tank.elevation = ai.plan.elevation;
    this.power = 0;
    this.state = 'charging';
  }

  updateCharging(dt) {
    this.power = Math.min(100, this.power + CONFIG.CHARGE_SPEED * dt);
    if (this.ai) {
      if (this.power >= this.ai.plan.power) {
        this.power = this.ai.plan.power;
        this.fire();
      }
      return;
    }
    this.timeLeft -= dt;
    if (this.power >= 100 || this.cursors.space.isUp || this.timeLeft <= 0) this.fire();
  }

  fire() {
    const tank = this.active;
    const weapon = CONFIG.WEAPONS[this.weaponIndex];
    tank.stock[this.weaponIndex] -= 1;
    tank.lastPower = this.power;

    const offsets = weapon.shells === 3
      ? [-CONFIG.TRIPLE_SPREAD, 0, CONFIG.TRIPLE_SPREAD]
      : [0];
    for (const offset of offsets) {
      const s = makeShell(tank.muzzle(tank.elevation + offset), this.power);
      s.weapon = weapon;
      s.owner = tank;
      s.sprite = this.add.image(s.x, s.y, 'shell').setDepth(CONFIG.DEPTH.SHELL);
      s.trail = this.add.particles(0, 0, 'dot', {
        follow: s.sprite, frequency: 28, lifespan: 380, scale: { start: 0.32, end: 0 },
        alpha: { start: 0.55, end: 0 }, tint: 0xe5e7eb,
      }).setDepth(CONFIG.DEPTH.SHELL - 1);
      this.shells.push(s);
    }
    this.followShell(this.shells[Math.floor(this.shells.length / 2)]);
    this.cameras.main.shake(90, 0.003);
    this.muzzleFlash(tank.muzzle());
    this.state = 'flying';
  }

  updateShells(dt) {
    const P = CONFIG.PHYSICS;
    this.stepAcc += dt;
    while (this.stepAcc >= P.STEP && this.shells.length) {
      this.stepAcc -= P.STEP;
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const s = this.shells[i];
        stepShell(s, this.wind);
        const hit = shellContact(s, this.terrain, this.tanks, s.owner);
        if (hit) {
          this.shells.splice(i, 1);
          this.finishShell(s, hit);
        }
      }
    }
    for (const s of this.shells) {
      s.sprite.setPosition(s.x, s.y).setRotation(Math.atan2(s.vy, s.vx));
    }
    if (!this.shells.length) {
      this.stepAcc = 0;
      this.followShell(null);
      this.settleTerrain();
      this.beginResolve();
    }
  }

  finishShell(s, hit) {
    s.sprite.destroy();
    s.trail.stop();
    this.time.delayedCall(500, () => s.trail.destroy());
    if (hit !== 'out') this.explode(s.x, s.y, s.weapon);
    // 따라가던 포탄이 끝나면 아직 날고 있는 다른 포탄으로 넘어간다.
    if (this.followedShell === s) this.followShell(this.shells[0] || null);
  }

  explode(x, y, weapon) {
    this.terrain.carve(x, y, weapon.radius);
    for (const t of this.tanks) {
      if (t.dead) continue;
      const d = Math.hypot(t.x - x, t.y - CONFIG.TANK.HIT_CENTER_Y - y);
      const edge = Math.max(0, d - CONFIG.TANK.BODY_RADIUS);
      if (edge < weapon.radius) {
        t.damage(Math.round(weapon.damage * (1 - edge / weapon.radius)));
      }
    }
    this.explosionFx(x, y, weapon.radius);
  }

  // 폭발 묶음이 끝난 뒤, 고정점과 끊긴 땅을 떨어뜨린다.
  settleTerrain() {
    const t0 = performance.now();
    const pieces = this.terrain.settle();
    this.lastSettleMs = performance.now() - t0;
    for (const p of pieces) {
      if (p.debris) this.debrisFx(p.x + p.w / 2, p.y + p.h / 2);
      else this.chunks.push(new FallingChunk(this, this.terrain, p));
    }
  }

  beginResolve() {
    this.resolveWait = 0.7;
    this.state = 'resolving';
  }

  updateResolving(dt) {
    this.resolveWait -= dt;
    if (this.resolveWait > 0) return;
    if (this.chunks.length || this.tanks.some((t) => t.falling)) return;

    const alive = this.tanks.filter((t) => !t.dead);
    if (alive.length < 2) this.endGame(alive[0] || null);
    else this.startTurn();
  }

  endGame(winner) {
    this.state = 'gameover';
    this.hud.hideTurnInfo();
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    const D = CONFIG.DEPTH.OVERLAY;
    this.add.rectangle(0, 0, W, H, 0x0b1a2b, 0.6).setOrigin(0).setDepth(D).setScrollFactor(0);
    const message = winner ? `${winner.player.name} 승리!` : '무승부';
    this.add.text(W / 2, H / 2 - 60, message, {
      fontFamily: CONFIG.FONT, fontSize: '76px', fontStyle: 'bold', color: '#fde047',
      stroke: '#0b1a2b', strokeThickness: 10,
    }).setOrigin(0.5).setDepth(D + 1).setScrollFactor(0);
    this.add.text(W / 2, H / 2 + 40, 'R: 다시 하기    T: 타이틀', {
      fontFamily: CONFIG.FONT, fontSize: '28px', color: '#ffffff',
      stroke: '#0b1a2b', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(D + 1).setScrollFactor(0);
    this.input.keyboard.once('keydown-R', () => this.scene.restart({ mode: this.mode }));
    this.input.keyboard.once('keydown-T', () => this.scene.start('Title'));
  }

  // ---- 이벤트 ----

  onTankDamaged(tank, amount) {
    const label = this.add.text(tank.x, tank.y - 80, `-${amount}`, {
      fontFamily: CONFIG.FONT, fontSize: '30px', fontStyle: 'bold', color: '#fca5a5',
      stroke: '#0b1a2b', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(CONFIG.DEPTH.FX);
    this.tweens.add({
      targets: label, y: label.y - 50, alpha: 0, duration: 900, onComplete: () => label.destroy(),
    });
  }

  onTankDestroyed(tank) {
    this.explosionFx(tank.x, Math.min(tank.y, CONFIG.WORLD_H - 10) - 20, 70);
  }

  // ---- 연출 ----

  burst(x, y, config, count) {
    const emitter = this.add.particles(x, y, 'dot', { emitting: false, ...config })
      .setDepth(CONFIG.DEPTH.FX);
    emitter.explode(count);
    this.time.delayedCall(config.lifespan + 200, () => emitter.destroy());
  }

  explosionFx(x, y, radius) {
    const ball = this.add.image(x, y, 'dot').setDepth(CONFIG.DEPTH.FX).setTint(0xffd27a)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(0.3);
    this.tweens.add({
      targets: ball, scale: (radius * 2.6) / 32, alpha: 0, duration: 340,
      onComplete: () => ball.destroy(),
    });
    this.burst(x, y, {
      speed: { min: 60, max: radius * 7 }, lifespan: 620, gravityY: 420,
      scale: { start: 0.6, end: 0 }, tint: [0xffb347, 0xff6b35, 0x6b4a2f, 0x3a2a1e],
    }, 36);
    this.cameras.main.shake(180, Math.min(0.012, radius / 6000));
  }

  debrisFx(x, y) {
    this.burst(x, y, {
      speed: { min: 30, max: 140 }, lifespan: 600, gravityY: 500,
      scale: { start: 0.35, end: 0 }, tint: [0x8b5a2b, 0x6b4a2f, 0x84cc16],
    }, 10);
  }

  muzzleFlash(m) {
    const flash = this.add.image(m.x, m.y, 'dot').setDepth(CONFIG.DEPTH.FX).setTint(0xfff1a8)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(1.6);
    this.tweens.add({
      targets: flash, scale: 0.2, alpha: 0, duration: 140, onComplete: () => flash.destroy(),
    });
  }

  // ---- ?debug: 충돌 마스크(자홍), 고정점(초록), 떨어지는 조각(빨강) ----

  setupDebug() {
    if (this.textures.exists('debugmask')) this.textures.remove('debugmask');
    this.debugTex = this.textures.createCanvas('debugmask', CONFIG.WORLD_W, CONFIG.WORLD_H);
    this.add.image(0, 0, 'debugmask').setOrigin(0).setDepth(CONFIG.DEPTH.TERRAIN + 1).setAlpha(0.35);
    this.debugG = this.add.graphics().setDepth(CONFIG.DEPTH.WORLD_UI);
    this.debugVersion = -1;
  }

  updateDebug() {
    const t = this.terrain;
    if (this.debugVersion !== t.version) {
      this.debugVersion = t.version;
      const ctx = this.debugTex.context;
      const img = ctx.createImageData(t.w, t.h);
      for (let i = 0; i < t.solid.length; i++) {
        if (!t.solid[i]) continue;
        img.data[i * 4] = 255;
        img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      this.debugTex.refresh();
    }
    const g = this.debugG;
    g.clear();
    g.lineStyle(3, 0x22c55e, 1);
    for (const a of t.anchors) g.strokeCircle(a.x, a.y, a.r);
    g.lineStyle(2, 0xff0000, 1);
    for (const c of this.chunks) g.strokeRect(c.x, c.y, c.w, c.h);
  }
}

// 배경은 화면을 덮도록 확대해 카메라에 고정한다.
function addFixedBackground(scene) {
  const src = scene.textures.get('bg').getSourceImage();
  const scale = Math.max(CONFIG.GAME_W / src.width, CONFIG.GAME_H / src.height);
  return scene.add.image(CONFIG.GAME_W / 2, CONFIG.GAME_H / 2, 'bg')
    .setScale(scale).setScrollFactor(0).setDepth(CONFIG.DEPTH.BACK);
}
