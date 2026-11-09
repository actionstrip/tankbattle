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
    this.setupEdgeMouse();

    // 루프 소리 상태 (updateAiming/updateAi가 매 프레임 켜고, updateLoopSounds가 반영)
    this.sndMove = false;
    this.sndAim = false;
    this.blockedPlayed = false;
    this.events.once('shutdown', () => {
      Sfx.stopLoops();
      Sfx.stop('game_win');
      Sfx.stop('game_lose');
    });

    // 배경음: 게임 중 반복 (씬이 끝나면 위 stopLoops에서 함께 꺼진다)
    Sfx.loop('loop2', true, { fade: 800 });

    this.playIntroSweep(() => this.startTurn());
  }

  // 스테이지 시작 연출: 맵 가운데에서 시작해 턴 순서대로 탱크를 하나씩 비춘다
  // (easeOut으로 이동 → 잠깐 멈춤 → 다음 탱크). 끝나면 콜백 (startTurn이 첫 탱크로 다시 이동).
  playIntroSweep(onDone) {
    const INTRO = { MOVE: 900, HOLD: 600 }; // 탱크 사이 이동 시간, 탱크에서 멈춰 있는 시간 (ms)
    const cam = this.cameras.main;
    const half = CONFIG.GAME_W / 2;
    this.state = 'intro';
    cam.stopFollow();
    cam.centerOn(CONFIG.WORLD_W / 2, CONFIG.WORLD_H / 2); // 맵 가운데

    const order = this.tanks.filter((t) => !t.dead);
    const visit = (i) => {
      if (i >= order.length) { onDone(); return; }
      const x = Phaser.Math.Clamp(order[i].x, half, CONFIG.WORLD_W - half);
      cam.pan(x, CONFIG.WORLD_H / 2, INTRO.MOVE, 'Cubic.easeOut', true, (c, progress) => {
        if (progress === 1) this.time.delayedCall(INTRO.HOLD, () => visit(i + 1));
      });
    };
    visit(0);
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

  // 마우스 위치를 창 전체에서 추적한다 (게임 화면 밖으로 나가도 게임 좌표로 환산).
  // Phaser 포인터는 캔버스 밖에서는 갱신되지 않으므로 window에서 직접 받는다.
  setupEdgeMouse() {
    this.edgeMouse = null; // { x: 게임 좌표 x, down: 버튼 눌림 여부 }
    const onMove = (e) => {
      const rect = this.game.canvas.getBoundingClientRect();
      if (!rect.width) return;
      this.edgeMouse = {
        x: (e.clientX - rect.left) * CONFIG.GAME_W / rect.width,
        down: e.buttons !== 0,
      };
    };
    const onBlur = () => { this.edgeMouse = null; }; // 다른 창으로 전환하면 멈춘다
    window.addEventListener('mousemove', onMove);
    window.addEventListener('blur', onBlur);
    this.events.once('shutdown', () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('blur', onBlur);
    });
  }

  // 내 턴에 마우스(누르지 않은 상태)를 화면 좌우 끝에 두면 그쪽으로 화면을 민다.
  // 게임 화면 밖(브라우저 여백·창 밖)으로 나가도 마지막 위치 기준으로 계속 반응한다.
  // 터치 입력이거나, 버튼(무기 슬롯 등) 위에 있으면 움직이지 않는다.
  updateEdgeScroll(dt) {
    if (!this.canDragCamera || this.drag) return;
    const m = this.edgeMouse;
    const p = this.input.activePointer;
    if (!m || m.down || p?.wasTouch) return;
    const E = CONFIG.EDGE_SCROLL;
    let dir = 0;
    let depth = 0;
    if (m.x < E.ZONE) { dir = -1; depth = (E.ZONE - m.x) / E.ZONE; }
    else if (m.x > CONFIG.GAME_W - E.ZONE) { dir = 1; depth = (m.x - (CONFIG.GAME_W - E.ZONE)) / E.ZONE; }
    if (!dir) return;
    if (this.input.isOver && this.input.hitTestPointer(p).length > 0) return;

    const cam = this.cameras.main;
    const maxX = CONFIG.WORLD_W - CONFIG.GAME_W;
    const next = Phaser.Math.Clamp(cam.scrollX + dir * E.SPEED * Math.min(1, depth) * dt, 0, maxX);
    if (next === cam.scrollX) return; // 이미 맵 끝
    cam.panEffect?.reset(); // 턴 시작 카메라 이동 중이면 멈춘다
    cam.stopFollow();
    cam.scrollX = next;
    this.cameraFree = true;
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
    this.sndMove = false;
    this.sndAim = false;
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
    this.updateEdgeScroll(dt);

    this.updateLoopSounds();
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
    const moveDir = this.cursors.left.isDown ? -1 : (this.cursors.right.isDown ? 1 : 0);
    if (moveDir) moved = tank.move(moveDir, dt);
    // 둘러보다가 탱크를 움직이면 화면이 다시 탱크를 따라간다.
    if (moved && this.cameraFree && !this.drag) this.followTank(tank);
    // 이동음: 키를 누르고 있고 막히지 않았으면 (1px 미만이라 이번 프레임에 안 움직였어도) 계속
    this.sndMove = !!moveDir && !tank.blocked && !tank.falling;
    // 막힘음: 키를 누른 채 처음 막혔을 때 한 번만
    if (moveDir && tank.blocked) {
      if (!this.blockedPlayed) Sfx.play('tank_move_blocked');
      this.blockedPlayed = true;
    } else {
      this.blockedPlayed = false;
    }

    const T = CONFIG.TANK;
    const prevElev = tank.elevation;
    if (this.cursors.up.isDown) tank.elevation += T.AIM_SPEED * dt;
    if (this.cursors.down.isDown) tank.elevation -= T.AIM_SPEED * dt;
    tank.elevation = Phaser.Math.Clamp(tank.elevation, T.ELEV_MIN, T.ELEV_MAX);
    this.sndAim = tank.elevation !== prevElev;

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
      this.sndAim = true;
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
      const size = weapon.scale || 1;
      s.sprite = this.add.image(s.x, s.y, 'shell').setScale(size).setDepth(CONFIG.DEPTH.SHELL);
      // 강력탄 등: 포탄 뒤에 은은하게 깜빡이는 빛 무리
      if (weapon.glow) {
        s.glow = this.add.image(s.x, s.y, 'dot').setTint(weapon.glow)
          .setBlendMode(Phaser.BlendModes.ADD).setScale(1.7 * size).setAlpha(0.9)
          .setDepth(CONFIG.DEPTH.SHELL - 1);
        this.tweens.add({
          targets: s.glow, alpha: 0.55, scale: 1.45 * size,
          duration: 180, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      }
      s.trail = this.add.particles(0, 0, 'dot', {
        follow: s.sprite, frequency: 28, lifespan: 380, scale: { start: 0.32 * size, end: 0 },
        alpha: { start: 0.55, end: 0 }, tint: weapon.glow || 0xe5e7eb,
      }).setDepth(CONFIG.DEPTH.SHELL - 2);
      this.shells.push(s);
    }
    this.followShell(this.shells[Math.floor(this.shells.length / 2)]);
    Sfx.play(`fire_${weapon.key}`, { rate: Phaser.Math.FloatBetween(0.95, 1.05), ...this.soundAt(tank.x) });
    this.cameras.main.shake(90, 0.003);
    const m = tank.muzzle();
    this.muzzleFlash(m);
    tank.recoil(m.dirX, weapon.recoil || 1);
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
      s.glow?.setPosition(s.x, s.y);
    }
    if (!this.shells.length) {
      this.stepAcc = 0;
      this.followShell(null);
      this.beginResolve();
    }
  }

  finishShell(s, hit) {
    s.sprite.destroy();
    if (s.glow) { this.tweens.killTweensOf(s.glow); s.glow.destroy(); }
    s.trail.stop();
    this.time.delayedCall(500, () => s.trail.destroy());
    if (hit !== 'out') {
      const radius = this.explode(s.x, s.y, s.weapon, Math.hypot(s.vx, s.vy));
      if (hit === 'tank') this.digBehindTank(s, radius);
    }
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

    // 폭발음: 무기별로 고르고, 세게 맞을수록(scale 0.7~1.3) 크게, 화면에서 멀수록 작게
    const id = { triple: 'explode_small', heavy: 'explode_big' }[weapon.key] || 'explode_normal';
    const at = this.soundAt(x);
    Sfx.play(id, {
      ...at,
      volume: at.volume * Phaser.Math.Clamp(0.55 + scale * 0.35, 0.7, 1),
      rate: Phaser.Math.FloatBetween(0.94, 1.06),
    });
    this.time.delayedCall(140, () => Sfx.play('dirt_debris', at));
    return radius;
  }

  // 탱크에 직접 맞으면 폭발이 공중이라 땅이 그대로 남아 어색하다.
  // 탱크가 맞은 충격으로 땅에 눌린 것처럼 탱크 바닥 모양대로 얕게 판다.
  // 포탄이 날아온 반대쪽이 더 깊어서 탱크가 그쪽으로 살짝 기울며 내려앉는다.
  digBehindTank(s, radius) {
    const T = CONFIG.TANK;
    const D = T.BLAST_DIG;
    // 맞은 탱크 = 착탄점에서 가장 가까운 탱크 (방금 폭발로 죽었을 수 있어 dead도 포함)
    const dist = (t) => Math.hypot(t.x - s.x, t.y - T.HIT_CENTER_Y - s.y);
    const tank = this.tanks.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    // 거의 수직으로 떨어졌으면 맞은 지점이 탱크 중심의 어느 쪽인지로 정한다.
    const dir = Math.abs(s.vx) > 40 ? Math.sign(s.vx) : (Math.sign(tank.x - s.x) || 1);
    // 탱크 몸체 이미지 폭 기준 (궤도는 몸체보다 조금 좁다)
    const half = (tank.body.width * tank.rigScale / 2) * D.WIDTH;
    const deep = radius * D.DEPTH;                 // 반대쪽 끝 깊이
    const shallow = deep * D.NEAR;                 // 맞은 쪽 끝 깊이
    this.terrain.pressDown(tank.x - half, tank.x + half, tank.y - T.MAX_CLIMB * 4, tank.y + D.MAX_DROP, (x) => {
      const u = (x - tank.x) / half;               // -1 ~ 1
      const far = (u * dir + 1) / 2;               // 맞은 쪽 0 → 반대쪽 1
      // 궤도처럼 양 끝이 둥글게 올라오도록
      const edge = Math.max(0, 1 - Math.abs(u));
      const round = Math.sqrt(Math.min(1, edge / D.ROUND));
      return (shallow + (deep - shallow) * far) * round;
    });
  }

  // 화면 중심에서 x까지 거리에 따른 볼륨·좌우 패닝. 화면 안이면 거의 그대로, 멀어질수록 작아진다.
  soundAt(x) {
    const mid = this.cameras.main.midPoint.x;
    const d = x - mid;
    const W = CONFIG.GAME_W;
    return {
      volume: Phaser.Math.Clamp(1 - Math.max(0, Math.abs(d) - W * 0.5) / W, 0.35, 1),
      pan: Phaser.Math.Clamp(d / W, -0.6, 0.6),
    };
  }

  // 루프 소리는 매 프레임 현재 상태로 켜고 끈다 → 상태가 바뀌면 자동으로 멈춘다.
  updateLoopSounds() {
    const s = this.state;
    Sfx.loop('tank_move', this.sndMove && s === 'aiming');
    Sfx.loop('barrel_aim', this.sndAim && s === 'aiming');
    // 충전음: 파워에 맞춰 피치 상승
    Sfx.loop('charge_loop', s === 'charging', { rate: 0.8 + (this.power / 100) * 0.8 });
    // 비행음: 따라가는 포탄 속도에 맞춰 피치 상승
    const sh = this.followedShell || this.shells[0];
    const speed = sh ? Math.hypot(sh.vx, sh.vy) : 0;
    Sfx.loop('shell_whistle', s === 'flying' && this.shells.length > 0, {
      rate: 0.85 + Phaser.Math.Clamp(speed / 1200, 0, 1) * 0.45,
    });
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
    // 결과음이 잘 들리도록 배경음은 부드럽게 끈다.
    Sfx.loop('loop2', false, { fade: 600 });
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    const D = CONFIG.DEPTH.OVERLAY;
    this.add.rectangle(0, 0, W, H, 0x0b1a2b, 0.55).setOrigin(0).setDepth(D).setScrollFactor(0);
    let message = '무승부';
    let color = 0xfbbf24;
    // 결과음: CPU 팀이 이기면 패배음, 그 외(사람 팀 승리·핫시트)는 승리음. 무승부는 소리 없음.
    if (winnerTeam) {
      const cpuWon = this.tanks.some((t) => t.player.team === winnerTeam && t.player.ai);
      Sfx.play(cpuWon ? 'game_lose' : 'game_win');
    }
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
    const once = (fn) => () => { if (!done) { done = true; Sfx.play('ui_click'); fn(); } };
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
    if (this.active.stock[i] > 0 && this.weaponIndex !== i) {
      this.weaponIndex = i;
      Sfx.play('weapon_select');
    }
  }

  // ---- 이벤트 ----

  onTankDamaged(tank, amount) {
    if (tank.hp > 0) Sfx.play('tank_hit', this.soundAt(tank.x)); // 격파 시엔 tank_destroyed만
    const label = this.add.text(tank.x, tank.y - 80, `-${amount}`, {
      fontFamily: CONFIG.FONT, fontSize: '30px', fontStyle: 'bold', color: '#fca5a5',
      stroke: '#0b1a2b', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(CONFIG.DEPTH.FX);
    this.tweens.add({
      targets: label, y: label.y - 50, alpha: 0, duration: 900, onComplete: () => label.destroy(),
    });
  }

  onTankDestroyed(tank) {
    Sfx.play('tank_destroyed', this.soundAt(tank.x));
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
