// 화면에 고정되는 UI(scrollFactor 0)와, 탱크를 따라다니는 월드 UI를 함께 관리한다.
import Phaser from 'phaser';
import { CONFIG } from './config';
import type { Team } from './config';
import { makeShell, shellContact, stepShell } from './projectile';
import type { ShellState } from './projectile';
import type { GameScene } from './scenes/GameScene';
import type { Tank } from './tank';
import type { Terrain } from './terrain';
import { UI, uiBar, uiPanel, uiText } from './ui';
import type { TextOptions } from './ui';

interface Rect { x: number; y: number; w: number; h: number }

interface CardRow {
  tank: Tank;
  name: Phaser.GameObjects.Text;
  hp: Phaser.GameObjects.Text;
  bar: { x: number; y: number; w: number };
}

interface WeaponSlot extends Rect {
  key: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  left: Phaser.GameObjects.Text;
}

export interface HudState {
  active: Tank | null;
  wind: number;
  timeLeft: number;
  power: number;
  weaponIndex: number;
  isAi: boolean;
  time: number;
  shell: ShellState | null;
}

export class Hud {
  private readonly scene: GameScene;
  private readonly tanks: Tank[];
  private readonly terrain: Terrain;
  private readonly panels: Phaser.GameObjects.Graphics;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly world: Phaser.GameObjects.Graphics;
  private readonly teamMode: boolean;
  private readonly cards: { rows: CardRow[] }[];
  private readonly timerPos: { x: number; y: number; r: number };
  private readonly timer: Phaser.GameObjects.Text;
  private readonly windBox: Rect;
  private readonly windValue: Phaser.GameObjects.Text;
  private readonly bannerBg: Phaser.GameObjects.Graphics;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly bottomItems: (Phaser.GameObjects.Text | Phaser.GameObjects.Zone)[] = [];
  private readonly bottomPanel: Phaser.GameObjects.Graphics;
  private readonly activeName: Phaser.GameObjects.Text;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly moveBar: Rect;
  private readonly powerBar: Rect;
  private hoverSlot = -1;
  private readonly slots: WeaponSlot[];
  private readonly mini: Rect;
  private readonly fps: Phaser.GameObjects.Text;
  private fpsAt = 0;
  private readonly miniTex: Phaser.Textures.CanvasTexture;
  private miniVersion = -1;
  private readonly arrowFrames: string[];
  private readonly arrow: Phaser.GameObjects.Image;
  private readonly tags: Phaser.GameObjects.Text[];

  constructor(scene: GameScene, tanks: Tank[], terrain: Terrain) {
    this.scene = scene;
    this.tanks = tanks;
    this.terrain = terrain;
    const D = CONFIG.DEPTH.HUD;
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    const fixed = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(
      o: T, depth = D + 1,
    ): T => { o.setScrollFactor(0).setDepth(depth); return o; };
    const text = (x: number, y: number, size: number, opts?: TextOptions) => fixed(uiText(scene, x, y, size, opts));

    this.panels = fixed(scene.add.graphics(), D);       // 고정 패널 배경 (한 번만 그림)
    this.g = fixed(scene.add.graphics(), D + 0.5);       // 매 프레임 바뀌는 막대·표시
    this.world = scene.add.graphics().setDepth(CONFIG.DEPTH.WORLD_UI);
    this.teamMode = tanks.length > 2;

    // ---- 상단 좌우: 팀 카드 (이름 + 소속 탱크 체력) ----
    this.cards = (['blue', 'red'] as Team[]).map((team, side) => {
      const members = tanks.filter((t) => t.player.team === team);
      const w = 270;
      const h = 40 + members.length * 22;
      const x = side === 0 ? 16 : W - 16 - w;
      const y = 14;
      const color = members[0].player.color;
      uiPanel(this.panels, x, y, w, h, { accent: color });
      const title = this.teamMode ? CONFIG.TEAMS[team] : members[0].player.name;
      text(x + 20, y + 9, 16).setText(title);
      const rows = members.map((t, i) => ({
        tank: t,
        name: text(x + 20, y + 35 + i * 22, 13, { color: UI.MUTED }).setText(this.teamMode ? t.player.name : '체력'),
        hp: text(x + w - 14, y + 35 + i * 22, 13).setOrigin(1, 0),
        bar: { x: x + 74, y: y + 39 + i * 22, w: w - 74 - 52 },
      }));
      return { rows };
    });

    // ---- 상단 가운데: 타이머 + 바람 ----
    this.timerPos = { x: W / 2, y: 46, r: 30 };
    this.timer = text(W / 2, 46, 30).setOrigin(0.5);
    this.windBox = { x: W / 2 - 130, y: 86, w: 260, h: 30 };
    uiPanel(this.panels, this.windBox.x, this.windBox.y, this.windBox.w, this.windBox.h, { radius: 15 });
    text(this.windBox.x + 14, this.windBox.y + 7, 13, { color: UI.MUTED }).setText('바람');
    this.windValue = text(this.windBox.x + this.windBox.w - 14, this.windBox.y + 6, 14).setOrigin(1, 0);

    // ---- 턴 안내 배너 ----
    this.bannerBg = fixed(scene.add.graphics(), D + 2).setAlpha(0);
    this.banner = text(W / 2, 160, 26, { stroke: 0 }).setOrigin(0.5).setDepth(D + 3).setAlpha(0);

    // ---- 하단 가운데: 조작 패널 ----
    // 좌우 패널(안내·미니맵) 폭 SIDE_W, 사이 간격 GAP_X로 가운데 패널이 남는 폭을 채운다.
    const SIDE_W = 272;
    const GAP_X = 14;
    const ph = 118;
    const px = 16 + SIDE_W + GAP_X;
    const P: Rect = { x: px, y: H - 14 - ph, w: W - px * 2, h: ph };
    const btext = (x: number, y: number, size: number, opts?: TextOptions) => {
      const t = text(x, y, size, opts);
      this.bottomItems.push(t);
      return t;
    };
    this.bottomPanel = fixed(scene.add.graphics(), D);
    uiPanel(this.bottomPanel, P.x, P.y, P.w, P.h);
    this.activeName = btext(P.x + 18, P.y + 10, 18);
    this.stats = btext(P.x + P.w - 18, P.y + 12, 14, { color: UI.MUTED }).setOrigin(1, 0);
    this.moveBar = { x: P.x + 60, y: P.y + 43, w: 150, h: 12 };
    this.powerBar = { x: P.x + 274, y: P.y + 43, w: P.w - 274 - 18, h: 12 };
    btext(P.x + 18, P.y + 40, 13, { color: UI.MUTED }).setText('이동');
    btext(P.x + 232, P.y + 40, 13, { color: UI.MUTED }).setText('파워');

    // 무기 슬롯 3칸
    const gap = 8;
    const sw = (P.w - 36 - gap * 2) / 3;
    this.slots = CONFIG.WEAPONS.map((w, i) => {
      const sx = P.x + 18 + i * (sw + gap);
      const sy = P.y + 68;
      // 클릭으로도 무기를 고를 수 있게 슬롯 위에 투명 영역을 둔다.
      const zone = fixed(scene.add.zone(sx + sw / 2, sy + 19, sw, 38), D + 2)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => scene.selectWeapon(i));
      zone.on('pointerover', () => { this.hoverSlot = i; });
      zone.on('pointerout', () => { if (this.hoverSlot === i) this.hoverSlot = -1; });
      this.bottomItems.push(zone);
      return {
        x: sx, y: sy, w: sw, h: 38,
        key: btext(sx + 17, sy + 19, 13).setOrigin(0.5).setText(`${i + 1}`),
        name: btext(sx + 36, sy + 10, 15).setText(w.name),
        left: btext(sx + sw - 12, sy + 11, 14, { color: UI.MUTED }).setOrigin(1, 0),
      };
    });

    // ---- 하단 왼쪽: 조작 안내 ----
    // 하단 세 패널(안내·조작·미니맵)은 높이와 윗선을 맞춘다.
    const help: Rect = { x: 16, y: P.y, w: SIDE_W, h: P.h };
    uiPanel(this.panels, help.x, help.y, help.w, help.h);
    text(help.x + 16, help.y + 10, 13, { color: UI.MUTED }).setText('조작 방법');
    const helpLines = [
      ['← →', '이동', '↑ ↓', '각도'],
      ['Space', '누르고 떼서 발사', '', ''],
      ['1 2 3', '무기 선택', '드래그', '화면 이동'],
    ];
    helpLines.forEach(([k1, d1, k2, d2], i) => {
      const y = help.y + 38 + i * 24;
      text(help.x + 16, y, 13, { color: UI.GOLD_CSS }).setText(k1);
      text(help.x + 66, y, 13, { bold: false }).setText(d1);
      if (k2) {
        text(help.x + 146, y, 13, { color: UI.GOLD_CSS }).setText(k2);
        text(help.x + 196, y, 13, { bold: false }).setText(d2);
      }
    });

    // ---- 하단 오른쪽: 미니맵 ----
    const mp: Rect = { x: W - 16 - SIDE_W, y: P.y, w: SIDE_W, h: P.h };
    const miniW = 256;
    const miniH = 77;
    this.mini = { x: mp.x + 8, y: mp.y + mp.h - 8 - miniH, w: miniW, h: miniH };
    uiPanel(this.panels, mp.x, mp.y, mp.w, mp.h);
    text(mp.x + 16, mp.y + 10, 13, { color: UI.MUTED }).setText('미니맵');
    // FPS 표시 (미니맵 패널 제목줄 오른쪽). 0.5초마다 갱신.
    this.fps = text(mp.x + mp.w - 14, mp.y + 10, 13).setOrigin(1, 0);
    if (scene.textures.exists('minimap')) scene.textures.remove('minimap');
    this.miniTex = scene.textures.createCanvas('minimap', this.mini.w, this.mini.h)!;
    fixed(scene.add.image(this.mini.x, this.mini.y, 'minimap').setOrigin(0), D + 0.2);

    // ---- 월드 UI: 화살표, 이름표 ----
    this.arrowFrames = scene.registry.get('arrowFrames') as string[];
    this.arrow = scene.add.image(0, 0, 'arrow', this.arrowFrames[0])
      .setOrigin(0.5, 1).setScale(CONFIG.TANK.MARKER_SCALE)
      .setDepth(CONFIG.DEPTH.WORLD_UI).setVisible(false);
    // 팀전에서는 같은 색 탱크를 구분하도록 탱크 아래에 이름표를 단다.
    this.tags = this.teamMode ? tanks.map((t) => uiText(scene, 0, 0, 13, { stroke: 4 })
      .setText(t.player.name).setOrigin(0.5, 0).setDepth(CONFIG.DEPTH.WORLD_UI)) : [];
  }

  showBanner(message: string): void {
    const W = CONFIG.GAME_W;
    this.banner.setText(message);
    const w = this.banner.width + 64;
    const h = 48;
    this.bannerBg.clear();
    uiPanel(this.bannerBg, W / 2 - w / 2, 160 - h / 2, w, h, { radius: h / 2, alpha: 0.85 });
    this.bannerBg.lineStyle(2, UI.GOLD, 0.9).strokeRoundedRect(W / 2 - w / 2, 160 - h / 2, w, h, h / 2);
    const targets = [this.banner, this.bannerBg];
    this.scene.tweens.killTweensOf(targets);
    for (const t of targets) t.setAlpha(1);
    this.scene.tweens.add({ targets, alpha: 0, delay: 1100, duration: 400 });
  }

  // 게임이 끝나면 하단 조작 패널과 배너를 숨긴다.
  hideTurnInfo(): void {
    this.scene.tweens.killTweensOf([this.banner, this.bannerBg]);
    this.banner.setAlpha(0);
    this.bannerBg.setAlpha(0);
    this.bottomPanel.setVisible(false);
    for (const t of this.bottomItems) {
      t.setVisible(false);
      if (t.input) t.disableInteractive();
    }
  }

  update({ active, wind, timeLeft, power, weaponIndex, isAi, time, shell }: HudState): void {
    const g = this.g;
    g.clear();
    this.world.clear();
    this.arrow.setVisible(false);

    if (time - this.fpsAt >= 500) {
      this.fpsAt = time;
      const fps = Math.round(this.scene.game.loop.actualFps);
      this.fps.setText(`${fps} FPS`).setColor(fps >= 50 ? '#4ade80' : fps >= 30 ? UI.GOLD_CSS : UI.DANGER);
    }
    this.drawTeamCards(g);
    this.drawTimer(g, timeLeft);
    this.drawWind(g, wind);
    this.drawMinimap(g);
    if (shell) this.drawShellIndicator(g, shell);

    for (const t of this.tanks) if (!t.dead) this.drawTankHpBar(this.world, t);
    this.tags.forEach((tag, i) => {
      const t = this.tanks[i];
      tag.setVisible(!t.dead).setPosition(t.x, t.y + 17);
    });

    if (active && !active.dead) {
      this.drawBottom(g, active, power, weaponIndex, isAi);
      this.drawMarker(active, time);
      if (!isAi) this.drawGuide(this.world, active, power, wind);
    }
  }

  private drawTeamCards(g: Phaser.GameObjects.Graphics): void {
    for (const card of this.cards) {
      for (const r of card.rows) {
        const hp = Math.max(0, r.tank.hp);
        const ratio = hp / CONFIG.TANK.MAX_HP;
        uiBar(g, r.bar.x, r.bar.y, r.bar.w, 8, ratio, r.tank.dead ? 0x475569 : r.tank.player.color);
        r.hp.setText(r.tank.dead ? '격파' : `${Math.ceil(hp)}`);
        r.hp.setColor(r.tank.dead ? UI.DANGER : UI.TEXT);
        r.name.setAlpha(r.tank.dead ? 0.5 : 1);
      }
    }
  }

  private drawTimer(g: Phaser.GameObjects.Graphics, timeLeft: number): void {
    const { x, y, r } = this.timerPos;
    const left = Math.max(0, timeLeft);
    const urgent = left <= 5;
    g.fillStyle(UI.PANEL, 0.85).fillCircle(x, y, r);
    // 남은 시간을 테두리 호로 보여 준다.
    g.lineStyle(4, 0x1e3348, 1).strokeCircle(x, y, r - 3);
    const ratio = left / CONFIG.TURN_SECONDS;
    if (ratio > 0) {
      g.lineStyle(4, urgent ? 0xef4444 : UI.GOLD, 1);
      g.beginPath();
      g.arc(x, y, r - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
      g.strokePath();
    }
    this.timer.setText(`${Math.ceil(left)}`).setColor(urgent ? UI.DANGER : UI.TEXT);
  }

  private drawWind(g: Phaser.GameObjects.Graphics, wind: number): void {
    const b = this.windBox;
    const cx = b.x + b.w / 2 + 4;
    const half = 66;
    const y = b.y + b.h / 2;
    g.fillStyle(0x1e3348, 1).fillRoundedRect(cx - half, y - 4, half * 2, 8, 4);
    g.fillStyle(0xffffff, 0.5).fillRect(cx - 1, y - 7, 2, 14);
    const len = (wind / CONFIG.PHYSICS.WIND_MAX) * half;
    if (len !== 0) {
      g.fillStyle(0x7dd3fc, 1).fillRoundedRect(Math.min(cx, cx + len), y - 4, Math.abs(len), 8, 4);
      // 바람 방향 화살촉
      const tip = cx + len;
      const d = Math.sign(len);
      g.fillTriangle(tip + d * 7, y, tip - d * 2, y - 7, tip - d * 2, y + 7);
    }
    this.windValue.setText(wind === 0 ? '없음' : `${wind > 0 ? '→' : '←'} ${Math.abs(wind)}`);
  }

  private drawBottom(g: Phaser.GameObjects.Graphics, tank: Tank, power: number, weaponIndex: number, isAi: boolean): void {
    this.activeName.setText(`${tank.player.name}${isAi ? '  CPU' : ''}`)
      .setColor(Phaser.Display.Color.IntegerToColor(tank.player.color).rgba);
    const tilt = Math.round(Phaser.Math.RadToDeg(-tank.slope * tank.facing));
    this.stats.setText(`각도 ${Math.round(tank.elevation)}°    기울기 ${tilt > 0 ? '+' : ''}${tilt}°    파워 ${Math.round(power)}`);

    // 이동량
    const m = this.moveBar;
    const fuel = Math.max(0, Math.min(CONFIG.TANK.FUEL, tank.fuel));
    uiBar(g, m.x, m.y, m.w, m.h, fuel / CONFIG.TANK.FUEL, fuel > 0 ? 0x4ade80 : 0x475569);

    // 파워 (25/50/75 눈금 + 지난번 파워 표시)
    const p = this.powerBar;
    uiBar(g, p.x, p.y, p.w, p.h, power / 100, UI.GOLD);
    g.fillStyle(0xffffff, 0.25);
    for (const q of [0.25, 0.5, 0.75]) g.fillRect(p.x + p.w * q - 0.5, p.y + 2, 1, p.h - 4);
    if (tank.lastPower !== null) {
      const mx = p.x + (p.w * tank.lastPower) / 100;
      g.fillStyle(0xffffff, 1).fillRoundedRect(mx - 1.5, p.y - 4, 3, p.h + 8, 1.5);
    }

    // 무기 슬롯
    this.slots.forEach((s, i) => {
      const selected = i === weaponIndex;
      const stock = tank.stock[i];
      const empty = stock <= 0;
      const hover = !selected && !empty && !isAi && i === this.hoverSlot;
      g.fillStyle(selected ? 0x23405f : hover ? 0x1b3349 : 0x13263a, 1).fillRoundedRect(s.x, s.y, s.w, s.h, 8);
      g.lineStyle(selected ? 2 : 1, selected ? UI.GOLD : 0xffffff, selected ? 1 : 0.12)
        .strokeRoundedRect(s.x, s.y, s.w, s.h, 8);
      g.fillStyle(selected ? UI.GOLD : 0x2c4560, 1).fillRoundedRect(s.x + 7, s.y + 9, 20, 20, 5);
      s.key.setColor(selected ? '#0b1a2b' : UI.TEXT);
      s.left.setText(stock === Infinity ? '∞' : `×${stock}`);
      for (const t of [s.key, s.name, s.left]) t.setAlpha(empty ? 0.35 : 1);
    });
  }

  // 탱크 바로 아래에 붙는 에너지 바
  private drawTankHpBar(g: Phaser.GameObjects.Graphics, tank: Tank): void {
    const w = 52;
    const x = tank.x - w / 2;
    const y = tank.y + 8;
    g.fillStyle(UI.PANEL, 0.8).fillRoundedRect(x - 2, y - 2, w + 4, 9, 4);
    uiBar(g, x, y, w, 5, tank.hp / CONFIG.TANK.MAX_HP, tank.player.color, 0x1e3348);
  }

  private drawMinimap(g: Phaser.GameObjects.Graphics): void {
    const m = this.mini;
    const sx = m.w / CONFIG.WORLD_W;
    const sy = m.h / CONFIG.WORLD_H;
    if (this.miniVersion !== this.terrain.version) {
      this.miniVersion = this.terrain.version;
      const ctx = this.miniTex.context;
      ctx.clearRect(0, 0, m.w, m.h);
      ctx.fillStyle = 'rgba(30, 51, 72, 0.9)';
      ctx.fillRect(0, 0, m.w, m.h);
      ctx.drawImage(this.terrain.texture.getSourceImage() as HTMLCanvasElement, 0, 0, m.w, m.h);
      this.miniTex.refresh();
    }
    const cam = this.scene.cameras.main;
    g.lineStyle(2, UI.GOLD, 0.9).strokeRoundedRect(m.x + cam.scrollX * sx, m.y, CONFIG.GAME_W * sx, m.h, 3);
    for (const t of this.tanks) {
      if (t.dead) continue;
      const px = m.x + t.x * sx;
      const py = m.y + (t.y - 10) * sy;
      g.fillStyle(0xffffff, 1).fillCircle(px, py, 5);
      g.fillStyle(t.player.color, 1).fillCircle(px, py, 3.5);
    }
  }

  // 화면 위로 올라간 포탄의 가로 위치를 상단에 표시한다.
  private drawShellIndicator(g: Phaser.GameObjects.Graphics, shell: ShellState): void {
    if (shell.y >= 0) return;
    const cam = this.scene.cameras.main;
    const x = Phaser.Math.Clamp(shell.x - cam.scrollX, 12, CONFIG.GAME_W - 12);
    g.fillStyle(UI.GOLD, 1).fillTriangle(x, 4, x - 10, 20, x + 10, 20);
  }

  // 조종 중인 탱크 위 화살표 (arrow.png 회전 프레임을 돌려 가며 표시).
  // 높이는 포신을 90°로 세웠을 때 총구 끝보다 MARKER_GAP 위로 잡아 부딪히지 않게 한다.
  private drawMarker(tank: Tank, time: number): void {
    const M = CONFIG.TANK;
    const s = tank.rigScale;
    const barrelTop = -tank.pivot.y * s + tank.barrelLength * s; // 탱크 바닥에서 세운 총구 끝까지
    const bob = (Math.sin(time / 180) + 1) * 0.5 * M.MARKER_BOB;   // 0 ~ BOB (아래로 내려와도 간격 유지)
    const frames = this.arrowFrames;
    const frame = frames[Math.floor(time / M.MARKER_FRAME_MS) % frames.length];
    this.arrow.setFrame(frame).setVisible(true)
      .setPosition(tank.x, tank.y - barrelTop - M.MARKER_GAP - bob);
  }

  // 예상 탄도의 앞 GUIDE_RATIO만큼을 점선으로 그린다 (바람 포함).
  // 충전 중이면 현재 파워, 아니면 지난번 파워(없으면 50) 기준.
  private drawGuide(g: Phaser.GameObjects.Graphics, tank: Tank, power: number, wind: number): void {
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
