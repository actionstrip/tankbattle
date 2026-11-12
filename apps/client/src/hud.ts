// 화면에 고정되는 UI(scrollFactor 0)와, 탱크를 따라다니는 월드 UI를 함께 관리한다.
import Phaser from 'phaser';
import { CONFIG } from './config';
import type { Team } from './config';
import { makeShell, shellContact, stepShell } from '@fortress/shared';
import type { ShellState } from '@fortress/shared';
import type { GameScene } from './scenes/GameScene';
import type { Tank } from './tank';
import type { Terrain } from './terrain';
import { UI, uiBar, uiPanel, uiText } from './ui';
import { Bgm, Sfx } from './sound';
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
  left: Phaser.GameObjects.Text;
  icons: Phaser.GameObjects.Image[];
  glow: number | null; // 강력탄처럼 아이콘 뒤에 빛을 그릴 색
}

const GAUGE_GREEN = 0x4ade80; // 포신
const GAUGE_RED = 0xef4444;   // 차체 기울기

export interface HudState {
  active: Tank | null;
  wind: number;
  timeLeft: number;
  power: number;
  weaponIndex: number;
  /** CPU 차례 (이름 옆에 CPU 표시) */
  isAi: boolean;
  /** 이 화면에서 조종하는 차례 (예상 탄도·무기 선택 표시). 온라인 상대 차례면 false */
  controlled: boolean;
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
  private readonly bottomItems: (Phaser.GameObjects.Text | Phaser.GameObjects.Zone | Phaser.GameObjects.Image)[] = [];
  private readonly gauge: { x: number; y: number; r: number };
  private readonly gaugeText: Phaser.GameObjects.Text;
  private readonly weaponName: Phaser.GameObjects.Text;
  private readonly weaponInfo: Phaser.GameObjects.Text;
  private readonly bgmBtn: { x: number; y: number; hover: boolean };
  private readonly bgmLabel: Phaser.GameObjects.Text;
  private readonly helpBtn: { x: number; y: number; hover: boolean };
  private help: Phaser.GameObjects.GameObject[] | null = null; // 열려 있는 조작 안내 팝업
  private readonly bottomPanel: Phaser.GameObjects.Graphics;
  private readonly activeName: Phaser.GameObjects.Text;
  private readonly powerText: Phaser.GameObjects.Text;
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

    // ---- 하단: 조작 패널 (왼쪽 끝 ~ 미니맵 앞) ----
    // 가장 중요한 각도·파워를 크게: 왼쪽에 각도 게이지, 오른쪽 폭 전체에 굵은 파워 바와 큰 숫자.
    //   1행 탱크 이름 / 2행 파워 바 + 숫자 / 3행 포탄 아이콘 · 무기 이름 · 이동 바(작게)
    const SIDE_W = 272;
    const GAP_X = 14;
    const ph = 118;
    const P: Rect = { x: 16, y: H - 14 - ph, w: W - 16 - SIDE_W - GAP_X - 16, h: ph };
    const btext = (x: number, y: number, size: number, opts?: TextOptions) => {
      const t = text(x, y, size, opts);
      this.bottomItems.push(t);
      return t;
    };
    this.bottomPanel = fixed(scene.add.graphics(), D);
    uiPanel(this.bottomPanel, P.x, P.y, P.w, P.h);

    const GR = 50;
    this.gauge = { x: P.x + 16 + GR, y: P.y + P.h / 2, r: GR };
    this.gaugeText = btext(this.gauge.x, this.gauge.y, 24, { stroke: 4 }).setOrigin(0.5);
    const x0 = this.gauge.x + GR + 20; // 게이지 오른쪽 내용 시작
    const right = P.x + P.w - 18;
    this.activeName = btext(x0, P.y + 10, 16);
    btext(x0, P.y + 44, 14, { color: UI.MUTED }).setText('파워');
    this.powerBar = { x: x0 + 42, y: P.y + 41, w: right - 72 - (x0 + 42), h: 22 };
    this.powerText = btext(right, P.y + 52, 30, { color: UI.GOLD_CSS, stroke: 4 }).setOrigin(1, 0.5);
    this.moveBar = { x: right - 80, y: P.y + 89, w: 80, h: 10 };
    btext(right - 80 - 34, P.y + 86, 12, { color: UI.MUTED }).setText('이동');

    // 포탄 슬롯 3칸: 아이콘 버튼 + 오른쪽에 선택한 무기 이름·수량
    const gap = 8;
    const sw = 48;
    const sh = 32;
    this.slots = CONFIG.WEAPONS.map((w, i) => {
      const sx = x0 + i * (sw + gap);
      const sy = P.y + 76;
      // 클릭으로도 무기를 고를 수 있게 슬롯 위에 투명 영역을 둔다.
      const zone = fixed(scene.add.zone(sx + sw / 2, sy + sh / 2, sw, sh), D + 2)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => scene.selectWeapon(i));
      zone.on('pointerover', () => { this.hoverSlot = i; });
      zone.on('pointerout', () => { if (this.hoverSlot === i) this.hoverSlot = -1; });
      this.bottomItems.push(zone);
      const cx = sx + sw / 2;
      const cy = sy + sh / 2;
      const icon = (dx: number, dy: number, scale: number, rot = 0) => {
        const img = fixed(scene.add.image(cx + dx, cy + dy, 'shell').setScale(scale).setRotation(rot));
        this.bottomItems.push(img);
        return img;
      };
      // 일반탄 1발 / 강력탄 큰 1발(+빛) / 3연발 작은 3발 부채꼴
      const icons = w.shells > 1
        ? [-1, 0, 1].map((k) => icon(-2, k * 7, 0.75, k * 0.22))
        : [icon(0, 0, w.scale ? 1.4 : 1.15)];
      return {
        x: sx, y: sy, w: sw, h: sh, icons, glow: w.glow ?? null,
        key: btext(sx + 4, sy + 2, 11).setText(`${i + 1}`),
        left: btext(sx + sw - 3, sy + sh - 1, 11, { stroke: 3 }).setOrigin(1, 1),
      };
    });
    const infoX = x0 + 3 * (sw + gap) + 6;
    this.weaponName = btext(infoX, P.y + 76, 15);
    this.weaponInfo = btext(infoX, P.y + 95, 12, { color: UI.MUTED, bold: false });

    // ---- 하단 오른쪽: 미니맵 ----
    const mp: Rect = { x: W - 16 - SIDE_W, y: P.y, w: SIDE_W, h: P.h };
    const miniW = 256;
    const miniH = 77;
    this.mini = { x: mp.x + 8, y: mp.y + mp.h - 8 - miniH, w: miniW, h: miniH };
    uiPanel(this.panels, mp.x, mp.y, mp.w, mp.h);
    text(mp.x + 16, mp.y + 10, 13, { color: UI.MUTED }).setText('미니맵');
    // FPS 표시 (미니맵 패널 제목줄 오른쪽). 0.5초마다 갱신.
    this.fps = text(mp.x + mp.w - 14, mp.y + 10, 13).setOrigin(1, 0);
    // 제목줄 버튼: [♪ BGM] [?]  (FPS 왼쪽)
    const by = mp.y + 18;
    this.helpBtn = { x: mp.x + mp.w - 84, y: by, hover: false };
    this.bgmBtn = { x: this.helpBtn.x - 12 - 8 - 30, y: by, hover: false };
    this.bgmLabel = text(this.bgmBtn.x, by, 12).setOrigin(0.5).setText('♪ BGM');
    text(this.helpBtn.x, by, 14).setOrigin(0.5).setText('?');
    const button = (b: { x: number; y: number; hover: boolean }, w: number, h: number, onClick: () => void) => {
      const z = fixed(scene.add.zone(b.x, b.y, w, h), D + 2).setInteractive({ useHandCursor: true });
      z.on('pointerdown', onClick);
      z.on('pointerover', () => { b.hover = true; });
      z.on('pointerout', () => { b.hover = false; });
    };
    // BGM만 끄고 켠다 (효과음은 그대로). M 키도 같은 동작.
    const toggleBgm = () => { Bgm.toggle(); Sfx.play('ui_click'); };
    button(this.bgmBtn, 60, 22, toggleBgm);
    button(this.helpBtn, 24, 24, () => { Sfx.play('ui_click'); this.toggleHelp(); });
    const keyboard = scene.input.keyboard;
    const onEsc = () => { if (this.help) this.toggleHelp(); };
    keyboard?.on('keydown-M', toggleBgm);
    keyboard?.on('keydown-ESC', onEsc);
    scene.events.once('shutdown', () => {
      keyboard?.off('keydown-M', toggleBgm);
      keyboard?.off('keydown-ESC', onEsc);
    });
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

  update({ active, wind, timeLeft, power, weaponIndex, isAi, controlled, time, shell }: HudState): void {
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
    this.drawTitleButtons(g);
    if (shell) this.drawShellIndicator(g, shell);

    for (const t of this.tanks) if (!t.dead) this.drawTankHpBar(this.world, t);
    this.tags.forEach((tag, i) => {
      const t = this.tanks[i];
      tag.setVisible(!t.dead).setPosition(t.x, t.y + 17);
    });

    if (active && !active.dead) {
      this.drawBottom(g, active, power, weaponIndex, isAi, controlled);
      this.drawMarker(active, time);
      // 예상 탄도는 이 화면에서 조종하는 차례에만
      if (controlled) this.drawGuide(this.world, active, power, wind);
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

  private drawBottom(
    g: Phaser.GameObjects.Graphics, tank: Tank, power: number, weaponIndex: number, isAi: boolean, controlled: boolean,
  ): void {
    this.activeName.setText(`${tank.player.name}${isAi ? '  CPU' : ''}`)
      .setColor(Phaser.Display.Color.IntegerToColor(tank.player.color).rgba);
    this.powerText.setText(`${Math.round(power)}`);
    this.drawAngleGauge(g, tank);

    // 이동량
    const m = this.moveBar;
    const fuel = Math.max(0, Math.min(CONFIG.TANK.FUEL, tank.fuel));
    uiBar(g, m.x, m.y, m.w, m.h, fuel / CONFIG.TANK.FUEL, fuel > 0 ? 0x4ade80 : 0x475569);

    // 파워 (25/50/75 눈금 + 지난번 파워 표시)
    const p = this.powerBar;
    // 빈 트랙도 보이도록 밝은 바탕 + 테두리
    uiBar(g, p.x, p.y, p.w, p.h, power / 100, UI.GOLD, 0x2a4561);
    g.lineStyle(1, 0xffffff, 0.2).strokeRoundedRect(p.x, p.y, p.w, p.h, p.h / 2);
    g.fillStyle(0xffffff, 0.3);
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
      const hover = !selected && !empty && controlled && i === this.hoverSlot;
      g.fillStyle(selected ? 0x23405f : hover ? 0x1b3349 : 0x13263a, 1).fillRoundedRect(s.x, s.y, s.w, s.h, 8);
      g.lineStyle(selected ? 2 : 1, selected ? UI.GOLD : 0xffffff, selected ? 1 : 0.12)
        .strokeRoundedRect(s.x, s.y, s.w, s.h, 8);
      // 어두운 포탄이 잘 보이도록 밝은 원판 (강력탄은 초록 빛)
      g.fillStyle(s.glow ?? 0x3b5573, empty ? 0.25 : s.glow !== null ? 0.6 : 1)
        .fillCircle(s.x + s.w / 2, s.y + s.h / 2, 13);
      s.key.setColor(selected ? UI.GOLD_CSS : UI.MUTED);
      s.left.setText(stock === Infinity ? '∞' : `×${stock}`);
      for (const t of [s.key, s.left, ...s.icons]) t.setAlpha(empty ? 0.35 : 1);
    });
    const w = CONFIG.WEAPONS[weaponIndex];
    const stock = tank.stock[weaponIndex];
    this.weaponName.setText(w.name);
    this.weaponInfo.setText(stock === Infinity ? '무제한' : `남은 ×${stock}`);
  }

  // 포 각도 게이지. 빨강 = 차체 기울기, 초록 = 포신(실제 발사 방향), 숫자 = 두 각을 더한 발사 각도.
  // 각도는 수평 기준, 탱크가 바라보는 쪽으로 잰다 (왼쪽을 보면 게이지도 좌우 반전).
  private drawAngleGauge(g: Phaser.GameObjects.Graphics, tank: Tank): void {
    const { x: cx, y: cy, r } = this.gauge;
    const f = tank.facing >= 0 ? 1 : -1;
    const tilt = Phaser.Math.RadToDeg(-tank.slope * tank.facing);
    const total = tank.elevation + tilt;
    const T = CONFIG.TANK;
    // 각도(도) → 화면 각도(rad)
    const ang = (deg: number) => (f > 0 ? -Phaser.Math.DegToRad(deg) : Math.PI + Phaser.Math.DegToRad(deg));
    const pt = (deg: number, rr: number) => ({ x: cx + Math.cos(ang(deg)) * rr, y: cy + Math.sin(ang(deg)) * rr });
    const arc = (rr: number, from: number, to: number) => {
      g.beginPath();
      g.arc(cx, cy, rr, ang(from), ang(to), f > 0 ? to > from : to < from);
      g.strokePath();
    };

    // 바탕 (타이머 원과 같은 스타일)
    g.fillStyle(UI.PANEL, 0.92).fillCircle(cx, cy, r);
    g.lineStyle(3, 0x1e3348, 1).strokeCircle(cx, cy, r - 2);
    g.lineStyle(1.5, UI.GOLD, 0.6).strokeCircle(cx, cy, r);
    // 수평선 + 0/45/90° 눈금
    g.lineStyle(1, 0xffffff, 0.25).lineBetween(cx - r + 6, cy, cx + r - 6, cy);
    g.lineStyle(1.5, 0xffffff, 0.4);
    for (const d of [0, 45, 90]) {
      const a = pt(d, r - 9);
      const b = pt(d, r - 4);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    // 올릴 수 있는 범위 (차체 기준 ELEV_MIN~MAX)
    g.lineStyle(5, GAUGE_GREEN, 0.18);
    arc(r - 7, tilt + T.ELEV_MIN, tilt + T.ELEV_MAX);
    // 차체 축 (빨강) + 수평→차체 호
    const b1 = pt(tilt, r - 8);
    const b2 = pt(tilt + 180, r - 8);
    g.lineStyle(3, GAUGE_RED, 1).lineBetween(b1.x, b1.y, b2.x, b2.y);
    if (Math.abs(tilt) >= 1) {
      g.lineStyle(2, GAUGE_RED, 0.9);
      arc(r * 0.42, 0, tilt);
    }
    // 포신 (초록) + 차체→포신 호
    g.lineStyle(2.5, GAUGE_GREEN, 0.9);
    arc(r * 0.62, tilt, total);
    const tip = pt(total, r - 6);
    g.lineStyle(4, GAUGE_GREEN, 1).lineBetween(cx, cy, tip.x, tip.y);
    g.fillStyle(GAUGE_GREEN, 1).fillCircle(tip.x, tip.y, 3.5);
    g.fillStyle(0xffffff, 1).fillCircle(cx, cy, 3);

    // 숫자는 포신과 겹치지 않는 쪽(보통 아래)에
    const ty = total > -20 ? cy + r * 0.5 : cy - r * 0.5;
    this.gaugeText.setText(`${Math.round(total)}°`).setPosition(cx, ty);
  }

  // 미니맵 제목줄 버튼: [♪ BGM] 알약(끄면 회색 + 사선), [?] 동그라미
  private drawTitleButtons(g: Phaser.GameObjects.Graphics): void {
    const b = this.bgmBtn;
    const on = Bgm.isEnabled();
    const w = 60;
    const h = 22;
    g.fillStyle(b.hover ? 0x23405f : 0x13263a, 1).fillRoundedRect(b.x - w / 2, b.y - h / 2, w, h, h / 2);
    g.lineStyle(1.5, on ? UI.GOLD : 0x64748b, on ? 0.9 : 0.6).strokeRoundedRect(b.x - w / 2, b.y - h / 2, w, h, h / 2);
    this.bgmLabel.setColor(on ? UI.GOLD_CSS : '#64748b');
    if (!on) g.lineStyle(2, 0x94a3b8, 0.9).lineBetween(b.x - w / 2 + 8, b.y + 7, b.x + w / 2 - 8, b.y - 7);

    const q = this.helpBtn;
    g.fillStyle(q.hover || this.help ? 0x23405f : 0x13263a, 1).fillCircle(q.x, q.y, 11);
    g.lineStyle(1.5, UI.GOLD, this.help ? 1 : 0.6).strokeCircle(q.x, q.y, 11);
  }

  // 조작 안내 팝업 열기/닫기 (? 버튼·Esc). 게임은 멈추지 않는다 (온라인).
  private toggleHelp(): void {
    if (this.help) {
      for (const o of this.help) o.destroy();
      this.help = null;
      return;
    }
    const scene = this.scene;
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    const D = CONFIG.DEPTH.OVERLAY;
    const fix = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T, d = D + 1): T => {
      o.setScrollFactor(0).setDepth(d);
      return o;
    };
    // 화면 전체를 덮어 뒤의 화면 드래그·버튼을 막고, 클릭하면 닫는다.
    const dim = fix(scene.add.rectangle(0, 0, W, H, 0x000000, 0.45).setOrigin(0), D).setInteractive();
    dim.on('pointerdown', () => this.toggleHelp());
    const lines: [string, string][] = [
      ['← →  /  A D', '이동'],
      ['↑ ↓  /  W S', '포 각도'],
      ['Space', '누르고 있다가 떼면 발사'],
      ['1  2  3', '포탄 선택'],
      ['드래그', '맵 둘러보기'],
      ['Enter', '채팅 (온라인)'],
      ['M', 'BGM 켜기/끄기'],
    ];
    const pw = 420;
    const ph = 92 + lines.length * 30;
    const px = W / 2 - pw / 2;
    const py = H / 2 - ph / 2;
    const g = fix(scene.add.graphics());
    uiPanel(g, px, py, pw, ph, { radius: 16, alpha: 0.95 });
    g.lineStyle(2, UI.GOLD, 0.8).strokeRoundedRect(px, py, pw, ph, 16);
    const objs: Phaser.GameObjects.GameObject[] = [dim, g];
    objs.push(fix(uiText(scene, W / 2, py + 30, 20).setText('조작 방법').setOrigin(0.5)));
    lines.forEach(([k, d], i) => {
      const y = py + 66 + i * 30;
      objs.push(fix(uiText(scene, px + 40, y, 15, { color: UI.GOLD_CSS }).setText(k).setOrigin(0, 0.5)));
      objs.push(fix(uiText(scene, px + 190, y, 15, { bold: false }).setText(d).setOrigin(0, 0.5)));
    });
    objs.push(fix(uiText(scene, W / 2, py + ph - 20, 12, { color: UI.MUTED, bold: false })
      .setText('아무 곳이나 클릭하거나 Esc로 닫기').setOrigin(0.5)));
    this.help = objs;
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
