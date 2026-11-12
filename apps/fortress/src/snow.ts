// 화면에 내리는 눈. 바람 방향·세기에 따라 옆으로 날리고, 바람이 바뀌면 서서히 따라간다.
// 화면 고정 좌표로 그리되, 카메라가 움직이면 먼 눈송이(작은 것)일수록 덜 따라 밀려 깊이감을 준다.
import type Phaser from 'phaser';
import { CONFIG } from './config';

interface Flake {
  depth: number; // 0 = 멀다, 1 = 가깝다
  r: number;
  fall: number;
  alpha: number;
  phase: number;
  swayFreq: number;
  vx: number;
  x: number;
  y: number;
}

export class Snow {
  private readonly scene: Phaser.Scene;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly flakes: Flake[] = [];
  private lastScrollX: number;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(CONFIG.DEPTH.SNOW);
    for (let i = 0; i < CONFIG.SNOW.COUNT; i++) {
      const f = {} as Flake;
      this.reset(f, true);
      this.flakes.push(f);
    }
    this.lastScrollX = scene.cameras.main.scrollX;
  }

  // anywhere=false면 화면 위쪽(또는 바람 불어오는 쪽 옆)에서 새로 떨어진다.
  private reset(f: Flake, anywhere: boolean, wind = 0): void {
    const S = CONFIG.SNOW;
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    f.depth = Math.random();
    f.r = S.SIZE[0] + (S.SIZE[1] - S.SIZE[0]) * f.depth;
    f.fall = S.FALL[0] + (S.FALL[1] - S.FALL[0]) * f.depth;
    f.alpha = 0.6 + 0.4 * f.depth;
    f.phase = Math.random() * Math.PI * 2;
    f.swayFreq = 0.8 + Math.random() * 1.2;
    f.vx = wind * S.WIND_SPEED * (0.5 + 0.5 * f.depth);
    if (anywhere) {
      f.x = Math.random() * W;
      f.y = Math.random() * H;
    } else if (Math.abs(wind) > 2 && Math.random() < 0.35) {
      // 바람이 세면 일부는 바람이 불어오는 쪽 화면 옆에서 들어온다
      f.x = wind > 0 ? -10 : W + 10;
      f.y = Math.random() * H * 0.8;
    } else {
      f.x = Math.random() * (W + 200) - 100;
      f.y = -10;
    }
  }

  update(dt: number, wind: number, time: number): void {
    const S = CONFIG.SNOW;
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    const cam = this.scene.cameras.main;
    const dScroll = cam.scrollX - this.lastScrollX;
    this.lastScrollX = cam.scrollX;
    const ease = 1 - Math.exp(-dt / S.WIND_EASE); // 바람 변화에 반응하는 속도

    const g = this.g;
    g.clear();
    for (const f of this.flakes) {
      const target = wind * S.WIND_SPEED * (0.5 + 0.5 * f.depth); // 가까운 눈일수록 더 날린다
      f.vx += (target - f.vx) * ease;
      const sway = Math.sin(time / 1000 * f.swayFreq + f.phase) * S.SWAY;
      f.x += (f.vx + sway) * dt - dScroll * (0.3 + 0.7 * f.depth);
      f.y += f.fall * dt;

      if (f.y > H + 10 || f.x < -120 || f.x > W + 120) this.reset(f, false, wind);
      g.fillStyle(0xffffff, f.alpha).fillCircle(f.x, f.y, f.r);
    }
  }
}
