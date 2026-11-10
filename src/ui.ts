// ---- 공통 UI 스타일 ----
// 모든 화면(타이틀·게임·결과)이 같은 패널/글자 규칙을 쓰도록 한 곳에 모은다.
import type Phaser from 'phaser';
import { CONFIG } from './config';
import { sourceImage } from './tankSlicer';

export const UI = {
  PANEL: 0x0b1a2b,
  PANEL_ALPHA: 0.78,
  BORDER: 0xffffff,
  BORDER_ALPHA: 0.14,
  GOLD: 0xfbbf24,
  GOLD_CSS: '#fbbf24',
  TEXT: '#ffffff',
  MUTED: '#9fb3c8',
  DANGER: '#ff6b6b',
  RADIUS: 12,
  STROKE: '#0b1a2b',
};

export interface PanelOptions {
  radius?: number;
  alpha?: number;
  accent?: number | null;
  border?: boolean;
}

// 반투명 남색 패널. accent를 주면 왼쪽에 색 띠를 단다.
export function uiPanel(
  g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number,
  { radius = UI.RADIUS, alpha = UI.PANEL_ALPHA, accent = null, border = true }: PanelOptions = {},
): void {
  g.fillStyle(UI.PANEL, alpha).fillRoundedRect(x, y, w, h, radius);
  if (border) g.lineStyle(1.5, UI.BORDER, UI.BORDER_ALPHA).strokeRoundedRect(x, y, w, h, radius);
  if (accent !== null) {
    g.fillStyle(accent, 1).fillRoundedRect(x, y, 6, h, { tl: radius, bl: radius, tr: 0, br: 0 });
  }
}

// 둥근 진행 바 (배경 + 채움)
export function uiBar(
  g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number,
  ratio: number, color: number, bg = 0x1e3348,
): void {
  const r = h / 2;
  g.fillStyle(bg, 1).fillRoundedRect(x, y, w, h, r);
  const fw = Math.max(0, Math.min(1, ratio)) * w;
  if (fw >= h) g.fillStyle(color, 1).fillRoundedRect(x, y, fw, h, r);
  else if (fw > 0) g.fillStyle(color, 1).fillCircle(x + r, y + r, Math.max(1, fw / 2));
}

export interface TextOptions {
  color?: string;
  bold?: boolean;
  stroke?: number;
  align?: string;
}

// 글자 스타일 (크기 단계: 13 / 16 / 20 / 30)
export function uiText(
  scene: Phaser.Scene, x: number, y: number, size: number,
  { color = UI.TEXT, bold = true, stroke = 0, align = 'left' }: TextOptions = {},
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, '', {
    fontFamily: CONFIG.FONT, fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal',
    color, stroke: UI.STROKE, strokeThickness: stroke, align,
  });
}

// 배경은 땅보다 느리게 움직인다 (시차 스크롤).
// 땅이 끝에서 끝까지 스크롤될 때 배경은 그 거리의 BG_PARALLAX 만큼만 움직이므로,
// 화면 폭 + 그만큼의 폭을 덮도록 확대한다.
const BG_PARALLAX = 0.5;
export function addFixedBackground(scene: Phaser.Scene): Phaser.GameObjects.Image {
  const src = sourceImage(scene, 'bg');
  const needW = CONFIG.GAME_W + (CONFIG.WORLD_W - CONFIG.GAME_W) * BG_PARALLAX;
  const scale = Math.max(needW / src.width, CONFIG.GAME_H / src.height);
  return scene.add.image(0, CONFIG.GAME_H / 2, 'bg')
    .setOrigin(0, 0.5).setScale(scale)
    .setScrollFactor(BG_PARALLAX, 0).setDepth(CONFIG.DEPTH.BACK);
}
