class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.mode = data.mode || 'cpu';
  }

  create() {
    addFixedBackground(this);
    this.terrain = new Terrain(this);
    const barrelInfo = this.registry.get('barrelInfo');
    // 모드별 참가자
    //   cpu = 1P vs CPU, 2p = 1:1 핫시트,
    //   2v2 = 블루팀(사람 2명) vs 레드팀(CPU 2대), 2v2hot = 2:2 핫시트(4명 모두 사람)
    const M = CONFIG.MODES[this.mode] || CONFIG.MODES.cpu;
    const players = (M.team ? CONFIG.TEAM_PLAYERS : CONFIG.PLAYERS)
      .map((p) => ({ ...p, ai: M.redAi && p.team === 'red' }));
    this.randomizeSpawns(players);
    this.tanks = players.map((p) => new Tank(this, this.terrain, p, barrelInfo));
    this.hud = new Hud(this, this.tanks, this.terrain);
    this.snow = new Snow(this);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, CONFIG.WORLD_W, CONFIG.WORLD_H);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.weaponKeys = [
      this.input.keyboard.addKey('ONE'),
      this.input.keyboard.addKey('TWO'),
      this.input.keyboard.addKey('THREE'),
    ];

    this.state = 'idle';
    this.activeIndex = -1; // startTurn이 먼저 넘기므로 첫 탱크부터 시작
    this.shells = [];
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
    this.setupCameraDrag();

    cam.centerOn(this.tanks[0].x, CONFIG.WORLD_H / 2);
    this.startTurn();
  }

  // 탱크마다 서로 다른 발판을 무작위로 골라 그 위 아무 곳에 놓는다 (한 발판에 한 대).
  // 발판이 탱크 수보다 적으면 남은 탱크는 이미 쓴 발판 중 넓은 곳에 간격을 두고 놓는다.
  randomizeSpawns(players) {
    const S = CONFIG.SPAWN;
    const plats = Phaser.Utils.Array.Shuffle(this.terrain.findPlatforms(S.MIN_PLATFORM));
    if (plats.length === 0) return; // 발판을 못 찾으면 설정값(spawnX) 그대로
    const used = plats.map(() => []);
    players.forEach((p, i) => {
      let k = i < plats.length ? i : -1;
      if (k < 0) {
        // 남는 탱크: 가장 넓은 발판에 다른 탱크와 MIN_GAP 이상 떨어진 자리
        k = plats.reduce((b, q, j) => ((q.x1 - q.x0) > (plats[b].x1 - plats[b].x0) ? j : b), 0);
      }
      const { x0, x1 } = plats[k];
      const lo = x0 + S.EDGE;
      const hi = Math.max(lo, x1 - S.EDGE);
      let x = Phaser.Math.Between(lo, hi);
      for (let tries = 0; tries < 30 && used[k].some((u) => Math.abs(u - x) < S.MIN_GAP); tries++) {
        x = Phaser.Math.Between(lo, hi);
      }
      used[k].push(x);
      p.spawnX = x;
    });
    // 가장 가까운 적을 바라보게 한다.
    for (const p of players) {
      const foes = players.filter((q) => q.team !== p.team);
      const near = foes.reduce((a, b) => (Math.abs(b.spawnX - p.spawnX) < Math.abs(a.spawnX - p.spawnX) ? b : a));
      p.facing = near.spawnX >= p.spawnX ? 1 : -1;
    }
  }

  get active() { return this.tanks[this.activeIndex]; }

  get isAiTurn() { return !!this.active?.player.ai; }

  // 살아 있는 탱크가 남은 팀 목록
  aliveTeams() {
    return [...new Set(this.tanks.filter((t) => !t.dead).map((t) => t.player.team))];
  }

  // ---- 카메라 ----

  focusTank(tank) {
    const cam = this.cameras.main;
    const half = CONFIG.GAME_W / 2;
    const x = Phaser.Math.Clamp(tank.x, half, CONFIG.WORLD_W - half);
    this.drag = null;
    this.cameraFree = false;
    cam.stopFollow();
    cam.pan(x, CONFIG.WORLD_H / 2, 700, 'Sine.easeInOut', true, (c, progress) => {
      if (progress === 1 && this.active === tank && this.state === 'aiming') this.followTank(tank);
    });
  }

  // 내 턴에 쏘기 전(조준·충전 중)에는 화면을 끌어서 맵을 둘러볼 수 있다.
  get canDragCamera() {
    return (this.state === 'aiming' || this.state === 'charging') && !this.ai;
  }

  setupCameraDrag() {
    const cam = this.cameras.main;
    this.drag = null;
    this.input.on('pointerdown', (p, over) => {
      // 버튼(무기 슬롯 등) 위를 누른 경우에는 화면을 끌지 않는다.
      if (!this.canDragCamera || over.length > 0) return;
      this.drag = { x: p.x, scrollX: cam.scrollX };
      cam.panEffect?.reset(); // 턴 시작 카메라 이동 중이면 멈춘다
      cam.stopFollow();
    });
    this.input.on('pointermove', (p) => {
      if (!this.drag || !p.isDown || !this.canDragCamera) return;
      const maxX = CONFIG.WORLD_W - CONFIG.GAME_W;
      cam.scrollX = Phaser.Math.Clamp(this.drag.scrollX - (p.x - this.drag.x), 0, maxX);
      this.cameraFree = true;
    });
    // 손을 떼도 둘러보던 화면에 그대로 머문다. 발사하면 포탄을 부드럽게 따라가고(followShell),
    // 탱크를 움직이면 다시 탱크를 따라간다. 끌지 않고 누르기만 했으면 탱크 추적을 되살린다.
    const end = () => {
      if (!this.drag) return;
      this.drag = null;
      if (!this.cameraFree && this.canDragCamera) this.followTank(this.active);
    };
    this.input.on('pointerup', end);
    this.input.on('pointerupoutside', end);
  }

  // 둘러보던 화면을 다시 탱크로 붙인다.
  followTank(tank) {
    this.cameraFree = false;
    this.cameras.main.startFollow(tank.root, false, 0.15, 0.15);
  }

  followShell(shell) {
    this.drag = null;
    this.cameraFree = false;
    this.followedShell = shell;
    const cam = this.cameras.main;
    cam.stopFollow();
    if (shell) cam.startFollow(shell.sprite, false, 0.1, 0.1);
  }

  // ---- 턴 ----

  startTurn() {
    // 다음 살아 있는 탱크로 넘긴다 (죽은 탱크는 건너뜀).
    const n = this.tanks.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.activeIndex + k) % n;
      if (!this.tanks[i].dead) { this.activeIndex = i; break; }
    }
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
    for (const t of this.tanks) t.update(dt);

    // 조준 중에 맵 아래로 떨어지는 등으로 탱크가 죽으면 쏘지 않고 바로 정산한다.
    // 조준 중에 내 탱크가 죽거나 한 팀이 전멸하면 쏘지 않고 바로 정산한다.
    if ((this.state === 'aiming' || this.state === 'charging')
      && (this.active.dead || this.aliveTeams().length < 2)) {
      this.beginResolve();
    }

    switch (this.state) {
      case 'aiming': this.updateAiming(dt); break;
      case 'charging': this.updateCharging(dt); break;
      case 'flying': this.updateShells(dt); break;
      case 'resolving': this.updateResolving(dt); break;
      default: break;
    }

    this.snow.update(dt, this.wind, time);
    this.hud.update({
      active: this.state === 'gameover' ? null : this.active,
      wind: this.wind,
      timeLeft: this.timeLeft,
      power: this.power,
      weaponIndex: this.weaponIndex,
      isAi: this.isAiTurn,
      time,
      shell: this.followedShell,
    });
    if (this.debug) this.updateDebug();
  }

  updateAiming(dt) {
    const tank = this.active;
    if (this.ai) { this.updateAi(dt); return; }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.beginResolve(); return; }

    let moved = false;
    if (this.cursors.left.isDown) moved = tank.move(-1, dt);
    else if (this.cursors.right.isDown) moved = tank.move(1, dt);
    // 둘러보다가 탱크를 움직이면 화면이 다시 탱크를 따라간다.
    if (moved && this.cameraFree && !this.drag) this.followTank(tank);

    const T = CONFIG.TANK;
    if (this.cursors.up.isDown) tank.elevation += T.AIM_SPEED * dt;
    if (this.cursors.down.isDown) tank.elevation -= T.AIM_SPEED * dt;
    tank.elevation = Phaser.Math.Clamp(tank.elevation, T.ELEV_MIN, T.ELEV_MAX);

    this.weaponKeys.forEach((key, i) => {
      if (Phaser.Input.Keyboard.JustDown(key)) this.selectWeapon(i);
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
      // 가장 가까운 살아 있는 적을 노린다.
      const enemies = this.tanks.filter((t) => !t.dead && t.player.team !== tank.player.team);
      const enemy = enemies.reduce((a, b) => (Math.abs(b.x - tank.x) < Math.abs(a.x - tank.x) ? b : a));
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
      this.beginResolve();
    }
  }

  finishShell(s, hit) {
    s.sprite.destroy();
    s.trail.stop();
    this.time.delayedCall(500, () => s.trail.destroy());
    if (hit !== 'out') this.explode(s.x, s.y, s.weapon, Math.hypot(s.vx, s.vy));
    // 따라가던 포탄이 끝나면 아직 날고 있는 다른 포탄으로 넘어간다.
    if (this.followedShell === s) this.followShell(this.shells[0] || null);
  }

  // speed: 착탄 순간 속도. 빠를수록 구덩이가 크고 데미지가 세다.
  explode(x, y, weapon, speed) {
    const P = CONFIG.PHYSICS;
    let scale = 1;
    if (speed !== undefined) {
      const k = Phaser.Math.Clamp(
        (speed - P.IMPACT_SPEED_MIN) / (P.IMPACT_SPEED_MAX - P.IMPACT_SPEED_MIN), 0, 1);
      scale = P.IMPACT_SCALE_MIN + (P.IMPACT_SCALE_MAX - P.IMPACT_SCALE_MIN) * k;
    }
    const radius = weapon.radius * scale;
    const damage = weapon.damage * scale;

    this.terrain.carve(x, y, radius);
    for (const t of this.tanks) {
      if (t.dead) continue;
      const d = Math.hypot(t.x - x, t.y - CONFIG.TANK.HIT_CENTER_Y - y);
      const edge = Math.max(0, d - CONFIG.TANK.BODY_RADIUS);
      if (edge < radius) {
        t.damage(Math.round(damage * (1 - edge / radius)));
      }
    }
    this.explosionFx(x, y, radius);
  }

  beginResolve() {
    this.resolveWait = 0.7;
    this.state = 'resolving';
  }

  updateResolving(dt) {
    this.resolveWait -= dt;
    if (this.resolveWait > 0) return;
    if (this.tanks.some((t) => t.falling)) return;

    const teams = this.aliveTeams();
    if (teams.length < 2) this.endGame(teams[0] || null);
    else this.startTurn();
  }

  // winnerTeam: 'blue' | 'red' | null(무승부)
  endGame(winnerTeam) {
    this.state = 'gameover';
    this.hud.hideTurnInfo();
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    const D = CONFIG.DEPTH.OVERLAY;
    this.add.rectangle(0, 0, W, H, 0x0b1a2b, 0.55).setOrigin(0).setDepth(D).setScrollFactor(0);
    let message = '무승부';
    let color = 0xfbbf24;
    if (winnerTeam) {
      const winner = this.tanks.find((t) => t.player.team === winnerTeam);
      const label = this.tanks.length > 2 ? CONFIG.TEAMS[winnerTeam] : winner.player.name;
      message = `${label} 승리!`;
      color = winner.player.color;
    }

    // 결과 패널
    const pw = 520;
    const ph = 230;
    const px = W / 2 - pw / 2;
    const py = H / 2 - ph / 2;
    const g = this.add.graphics().setDepth(D + 1).setScrollFactor(0);
    uiPanel(g, px, py, pw, ph, { radius: 18, alpha: 0.92 });
    g.lineStyle(3, color, 1).strokeRoundedRect(px, py, pw, ph, 18);
    g.fillStyle(color, 1).fillRoundedRect(px, py, pw, 8, { tl: 18, tr: 18, bl: 0, br: 0 });

    const fixed = (t) => t.setDepth(D + 2).setScrollFactor(0);
    fixed(uiText(this, W / 2, py + 52, 16, { color: UI.MUTED })).setText('게임 종료').setOrigin(0.5);
    fixed(uiText(this, W / 2, py + 102, 56, { color: UI.GOLD_CSS, stroke: 8 })).setText(message).setOrigin(0.5);

    // 버튼: [R] 다시 하기   [T] 타이틀 — 키보드와 마우스 클릭 모두 동작
    let done = false;
    const once = (fn) => () => { if (!done) { done = true; fn(); } };
    const restart = once(() => this.scene.restart({ mode: this.mode }));
    const toTitle = once(() => this.scene.start('Title'));
    const buttons = [['R', '다시 하기', restart], ['T', '타이틀', toTitle]];
    buttons.forEach(([k, label, action], i) => {
      const cx = W / 2 + (i === 0 ? -100 : 100);
      const cy = py + ph - 46;
      const bg = this.add.graphics().setDepth(D + 1.5).setScrollFactor(0);
      const draw = (hover) => {
        bg.clear();
        bg.fillStyle(hover ? 0x23405f : 0x13263a, 1).fillRoundedRect(cx - 80, cy - 20, 160, 40, 10);
        bg.lineStyle(hover ? 2 : 1.5, hover ? UI.GOLD : 0xffffff, hover ? 1 : 0.15)
          .strokeRoundedRect(cx - 80, cy - 20, 160, 40, 10);
        bg.fillStyle(UI.GOLD, 1).fillRoundedRect(cx - 68, cy - 12, 24, 24, 6);
      };
      draw(false);
      fixed(uiText(this, cx - 56, cy, 14, { color: '#0b1a2b' })).setText(k).setOrigin(0.5);
      fixed(uiText(this, cx - 34, cy, 16)).setText(label).setOrigin(0, 0.5);
      const zone = this.add.zone(cx, cy, 160, 40).setScrollFactor(0).setDepth(D + 3)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => draw(true));
      zone.on('pointerout', () => draw(false));
      zone.on('pointerup', action);
    });
    this.input.keyboard.once('keydown-R', restart);
    this.input.keyboard.once('keydown-T', toTitle);
  }

  // 무기 선택 (키보드 1·2·3 또는 무기 슬롯 클릭). 내 턴 조준 중에만, 남은 탄이 있을 때만.
  selectWeapon(i) {
    if (this.state !== 'aiming' || this.ai) return;
    if (this.active.stock[i] > 0) this.weaponIndex = i;
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

  muzzleFlash(m) {
    const flash = this.add.image(m.x, m.y, 'dot').setDepth(CONFIG.DEPTH.FX).setTint(0xfff1a8)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(1.6);
    this.tweens.add({
      targets: flash, scale: 0.2, alpha: 0, duration: 140, onComplete: () => flash.destroy(),
    });
  }

  // ---- ?debug: 충돌 마스크(자홍), 고정점(초록) ----

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
  }
}

// 배경은 땅보다 느리게 움직인다 (시차 스크롤).
// 땅이 끝에서 끝까지 스크롤될 때 배경은 그 거리의 BG_PARALLAX 만큼만 움직이므로,
// 화면 폭 + 그만큼의 폭을 덮도록 확대한다.
const BG_PARALLAX = 0.5;
function addFixedBackground(scene) {
  const src = scene.textures.get('bg').getSourceImage();
  const needW = CONFIG.GAME_W + (CONFIG.WORLD_W - CONFIG.GAME_W) * BG_PARALLAX;
  const scale = Math.max(needW / src.width, CONFIG.GAME_H / src.height);
  return scene.add.image(0, CONFIG.GAME_H / 2, 'bg')
    .setOrigin(0, 0.5).setScale(scale)
    .setScrollFactor(BG_PARALLAX, 0).setDepth(CONFIG.DEPTH.BACK);
}
