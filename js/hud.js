// 남은 이동량 바 위치 (파워 바 왼쪽)
const MOVE_BAR = { x: 180, w: 200 };

// 화면에 고정되는 UI(scrollFactor 0)와, 탱크를 따라다니는 월드 UI를 함께 관리한다.
class Hud {
  constructor(scene, tanks, terrain) {
    this.scene = scene;
    this.tanks = tanks;
    this.terrain = terrain;
    const D = CONFIG.DEPTH.HUD;
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    const text = (x, y, size, origin = 0) => scene.add.text(x, y, '', {
      fontFamily: CONFIG.FONT, fontSize: `${size}px`, fontStyle: 'bold',
      color: '#ffffff', stroke: '#0b1a2b', strokeThickness: 5,
    }).setOrigin(origin, 0).setDepth(D + 1).setScrollFactor(0);

    this.g = scene.add.graphics().setDepth(D).setScrollFactor(0);
    this.world = scene.add.graphics().setDepth(CONFIG.DEPTH.WORLD_UI);

    this.names = [text(16, 12, 22), text(W - 16, 12, 22, 1)];
    this.names[0].setText(tanks[0].player.name);
    this.names[1].setText(tanks[1].player.name);
    this.timer = text(W / 2, 8, 34, 0.5);
    this.wind = text(W / 2, 50, 18, 0.5);
    this.banner = text(W / 2, 100, 30, 0.5);
    this.info = text(W / 2, H - 104, 20, 0.5);
    this.weapons = text(W / 2, H - 34, 18, 0.5);
    this.help = text(16, H - 30, 14);
    this.help.setText('←→ 이동  ↑↓ 각도  Space 충전/발사  1·2·3 무기  드래그 화면 이동').setAlpha(0.85);

    // 미니맵: 지형 캔버스를 1/10로 축소해 그린다.
    this.mini = { w: 256, h: 77, x: W - 16 - 256, y: H - 16 - 77 };
    if (scene.textures.exists('minimap')) scene.textures.remove('minimap');
    this.miniTex = scene.textures.createCanvas('minimap', this.mini.w, this.mini.h);
    scene.add.image(this.mini.x, this.mini.y, 'minimap').setOrigin(0).setDepth(D).setScrollFactor(0);
    this.miniVersion = -1;
  }

  showBanner(message) {
    this.banner.setText(message).setAlpha(1);
    this.scene.tweens.killTweensOf(this.banner);
    this.scene.tweens.add({ targets: this.banner, alpha: 0, delay: 1100, duration: 400 });
  }

  hideTurnInfo() {
    this.scene.tweens.killTweensOf(this.banner);
    for (const t of [this.banner, this.info, this.weapons]) t.setText('');
  }

  update({ active, wind, timeLeft, power, weaponIndex, isAi, time, shell }) {
    const g = this.g;
    const W = CONFIG.GAME_W;
    g.clear();
    this.world.clear();

    this.timer.setText(`${Math.ceil(Math.max(0, timeLeft))}`);
    this.timer.setColor(timeLeft <= 5 ? '#ff6b6b' : '#ffffff');

    const dirLabel = wind === 0 ? '없음' : (wind > 0 ? '→' : '←');
    this.wind.setText(`바람 ${dirLabel} ${Math.abs(wind)}`);
    this.drawWind(g, W / 2, 82, wind);

    this.drawMinimap(g);
    if (shell) this.drawShellIndicator(g, shell);
    for (const t of this.tanks) if (!t.dead) this.drawTankHpBar(this.world, t);

    if (active && !active.dead) {
      this.drawPowerBar(g, active, power);
      this.drawMoveBar(g, active);
      this.drawMarker(this.world, active, time);
      if (!isAi) this.drawGuide(this.world, active, power, wind);
      // 차체 기울기: 포신 쪽(앞)이 들리면 +, 숙여지면 -
      const tilt = Math.round(Phaser.Math.RadToDeg(-active.slope * active.facing));
      const tiltLabel = tilt > 0 ? `+${tilt}` : `${tilt}`;
      this.info.setText(`${active.player.name}${isAi ? ' (CPU)' : ''}   각도 ${Math.round(active.elevation)}°   기울기 ${tiltLabel}°   파워 ${Math.round(power)}`);
      this.weapons.setText(CONFIG.WEAPONS.map((w, i) => {
        const left = active.stock[i] === Infinity ? '∞' : active.stock[i];
        return `${i === weaponIndex ? '▶' : ''}${i + 1}.${w.name}(${left})`;
      }).join('    '));
    }
  }

  drawWind(g, x, y, wind) {
    const half = 80;
    g.fillStyle(0x0b1a2b, 0.75).fillRoundedRect(x - half, y - 5, half * 2, 10, 5);
    const len = (wind / CONFIG.PHYSICS.WIND_MAX) * half;
    g.fillStyle(0x7dd3fc, 1).fillRect(Math.min(x, x + len), y - 3, Math.abs(len), 6);
  }

  drawPowerBar(g, tank, power) {
    const w = 460;
    const x = (CONFIG.GAME_W - w) / 2;
    const y = CONFIG.GAME_H - 70;
    g.fillStyle(0x0b1a2b, 0.85).fillRoundedRect(x - 4, y - 4, w + 8, 30, 8);
    g.fillStyle(0xfbbf24, 1).fillRect(x, y, (w * power) / 100, 22);
    if (tank.lastPower !== null) {
      const mx = x + (w * tank.lastPower) / 100;
      g.fillStyle(0xffffff, 1).fillRect(mx - 1, y - 4, 3, 30);
    }
  }

  // 이번 턴에 남은 이동량 (화면 고정, 파워 바 왼쪽)
  drawMoveBar(g, tank) {
    const { x, w } = MOVE_BAR;
    const y = CONFIG.GAME_H - 70;
    const max = CONFIG.TANK.FUEL;
    const left = Math.max(0, Math.min(max, tank.fuel));
    g.fillStyle(0x0b1a2b, 0.85).fillRoundedRect(x - 4, y - 4, w + 8, 30, 8);
    g.fillStyle(left > 0 ? 0x4ade80 : 0x64748b, 1).fillRect(x, y, (w * left) / max, 22);
  }

  // 탱크 바로 아래에 붙는 에너지 바
  drawTankHpBar(g, tank) {
    const w = 56;
    const x = tank.x - w / 2;
    const y = tank.y + 8;
    const hp = Math.max(0, Math.min(1, tank.hp / CONFIG.TANK.MAX_HP));
    g.fillStyle(0x0b1a2b, 0.8).fillRect(x - 2, y - 2, w + 4, 9);
    g.fillStyle(tank.player.color, 1).fillRect(x, y, w * hp, 5);
  }

  drawMinimap(g) {
    const m = this.mini;
    const sx = m.w / CONFIG.WORLD_W;
    const sy = m.h / CONFIG.WORLD_H;
    if (this.miniVersion !== this.terrain.version) {
      this.miniVersion = this.terrain.version;
      const ctx = this.miniTex.context;
      ctx.clearRect(0, 0, m.w, m.h);
      ctx.fillStyle = 'rgba(11, 26, 43, 0.6)';
      ctx.fillRect(0, 0, m.w, m.h);
      ctx.drawImage(this.terrain.texture.getSourceImage(), 0, 0, m.w, m.h);
      this.miniTex.refresh();
    }
    const cam = this.scene.cameras.main;
    g.lineStyle(2, 0xffffff, 0.9).strokeRect(m.x + cam.scrollX * sx, m.y, CONFIG.GAME_W * sx, m.h);
    for (const t of this.tanks) {
      if (t.dead) continue;
      g.fillStyle(t.player.color, 1).fillCircle(m.x + t.x * sx, m.y + (t.y - 10) * sy, 4);
    }
    g.lineStyle(2, 0x0b1a2b, 1).strokeRect(m.x, m.y, m.w, m.h);
  }

  // 화면 위로 올라간 포탄의 가로 위치를 상단에 표시한다.
  drawShellIndicator(g, shell) {
    if (shell.y >= 0) return;
    const cam = this.scene.cameras.main;
    const x = Phaser.Math.Clamp(shell.x - cam.scrollX, 12, CONFIG.GAME_W - 12);
    g.fillStyle(0xfde047, 1).fillTriangle(x, 4, x - 10, 20, x + 10, 20);
  }

  drawMarker(g, tank, time) {
    const bob = Math.sin(time / 180) * 5;
    const y = tank.y - CONFIG.TANK.MARKER_Y + bob;
    g.fillStyle(0xfde047, 1);
    g.fillTriangle(tank.x - 12, y, tank.x + 12, y, tank.x, y + 16);
  }

  // 예상 탄도의 앞 GUIDE_RATIO만큼을 점선으로 그린다 (바람 포함).
  // 충전 중이면 현재 파워, 아니면 지난번 파워(없으면 50) 기준.
  drawGuide(g, tank, power, wind) {
    const GUIDE_RATIO = 0.7;
    const p = power > 0 ? power : (tank.lastPower ?? 50);
    const s = makeShell(tank.muzzle(), p);
    const pts = [s.x, s.y];
    let hit = null;
    let n = 0;
    while (!hit) {
      stepShell(s, wind);
      hit = shellContact(s, this.terrain, this.tanks, tank);
      if (++n % 6 === 0) pts.push(s.x, s.y);
    }
    pts.push(s.x, s.y);

    const count = Math.max(2, Math.floor((pts.length / 2) * GUIDE_RATIO));
    // 점 간격을 거리 기준으로 일정하게 찍는다. 끝으로 갈수록 흐려진다.
    const GAP = 14;
    let acc = 0;
    for (let i = 1; i < count; i++) {
      const x0 = pts[(i - 1) * 2], y0 = pts[(i - 1) * 2 + 1];
      const x1 = pts[i * 2], y1 = pts[i * 2 + 1];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      while (acc <= seg) {
        const t = seg > 0 ? acc / seg : 0;
        const alpha = 0.9 * (1 - (i / count) * 0.7);
        g.fillStyle(0xffffff, alpha).fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 2.5);
        acc += GAP;
      }
      acc -= seg;
    }
  }
}
