import Phaser from 'phaser';
import { CONFIG } from '../config';
import type { GameMode } from '../config';
import { Sfx } from '../sound';
import { sourceImage } from '../tankSlicer';
import { UI, addFixedBackground, uiPanel, uiText } from '../ui';

export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create(): void {
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    addFixedBackground(this);

    // 맵 전체가 보이도록 땅을 화면 폭에 맞춰 하단 정렬로 깐다.
    const ground = sourceImage(this, 'ground');
    this.add.image(0, H, 'ground').setOrigin(0, 1).setScale(W / ground.width);
    this.add.rectangle(0, 0, W, H, 0x0b1a2b, 0.45).setOrigin(0);

    // 로고: 살짝 위아래로 떠 있는 느낌
    const logoSrc = sourceImage(this, 'logo');
    const logo = this.add.image(W / 2, 200, 'logo').setScale(600 / logoSrc.width);
    this.tweens.add({ targets: logo, y: 190, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // 2×2 배치: 위 줄 1:1, 아래 줄 2:2 / 왼쪽 CPU 대전, 오른쪽 핫시트
    const colL = W / 2 - 200;
    const colR = W / 2 + 200;
    this.addButton(colL, 440, '1P  vs  CPU', '혼자서 CPU와 1:1 대결', () => this.begin('cpu'));
    this.addButton(colR, 440, '1:1  핫시트', '한 키보드로 둘이 번갈아', () => this.begin('2p'));
    this.addButton(colL, 530, '2:2  팀전', '블루팀 2명 vs CPU 2대', () => this.begin('2v2'));
    this.addButton(colR, 530, '2:2  핫시트', '한 키보드로 넷이 번갈아', () => this.begin('2v2hot'));

    // 조작 안내 띠
    const keys = [['← →', '이동'], ['↑ ↓', '각도'], ['Space', '누르고 떼서 발사'], ['1 2 3', '무기'], ['드래그', '화면 이동']];
    const g = this.add.graphics();
    const items = keys.map(([k, d]) => {
      const kt = uiText(this, 0, 0, 14, { color: UI.GOLD_CSS });
      kt.setText(k);
      const dt = uiText(this, 0, 0, 14, { bold: false });
      dt.setText(d);
      return { kt, dt, w: kt.width + 8 + dt.width };
    });
    const spacing = 28;
    const total = items.reduce((a, it) => a + it.w, 0) + spacing * (items.length - 1);
    const stripW = total + 48;
    const stripY = 672;
    uiPanel(g, W / 2 - stripW / 2, stripY - 20, stripW, 40, { radius: 20 });
    let x = W / 2 - total / 2;
    for (const it of items) {
      it.kt.setPosition(x, stripY).setOrigin(0, 0.5);
      it.dt.setPosition(x + it.kt.width + 8, stripY).setOrigin(0, 0.5);
      x += it.w + spacing;
    }

    // 배경음: 타이틀에 있는 동안 반복, 게임으로 넘어가면 부드럽게 끈다.
    this.events.once('shutdown', () => Sfx.loop('loop1', false, { fade: 400 }));
    const startMusic = () => Sfx.loop('loop1', true, { fade: 800 });
    // 브라우저는 첫 클릭/키 입력 전까지 소리를 막는다 → 페이지를 연 뒤 처음 한 번만 안내 팝업으로 입력을 받는다.
    if (this.registry.get('soundUnlocked')) startMusic();
    else this.showSoundPrompt(startMusic);
  }

  private showSoundPrompt(onClose: () => void): void {
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    const D = CONFIG.DEPTH.OVERLAY;
    const keyboard = this.input.keyboard!;
    // 화면 전체를 덮어 뒤의 메뉴 버튼이 눌리지 않게 한다.
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0).setDepth(D)
      .setInteractive();
    const pw = 460;
    const ph = 220;
    const px = W / 2 - pw / 2;
    const py = H / 2 - ph / 2;
    const g = this.add.graphics().setDepth(D + 1);
    uiPanel(g, px, py, pw, ph, { radius: 16, alpha: 0.95 });
    g.lineStyle(2, UI.GOLD, 0.8).strokeRoundedRect(px, py, pw, ph, 16);
    // 스피커 아이콘
    const ix = W / 2 - 14;
    const iy = py + 52;
    g.fillStyle(UI.GOLD, 1)
      .fillRect(ix - 10, iy - 7, 9, 14)
      .fillTriangle(ix - 2, iy - 7, ix + 12, iy - 18, ix + 12, iy + 18)
      .fillTriangle(ix - 2, iy - 7, ix - 2, iy + 7, ix + 12, iy + 18);
    g.lineStyle(3, UI.GOLD, 1);
    for (const r of [10, 18]) {
      g.beginPath();
      g.arc(ix + 14, iy, r, -0.7, 0.7);
      g.strokePath();
    }
    const msg = uiText(this, W / 2, py + 112, 22, { align: 'center' }).setText('소리를 켜고 게임을 시작하세요')
      .setOrigin(0.5).setDepth(D + 1);
    const hint = uiText(this, W / 2, py + 172, 16, { color: UI.GOLD_CSS }).setText('클릭하거나 아무 키나 누르세요')
      .setOrigin(0.5).setDepth(D + 1);
    const blink = this.tweens.add({ targets: hint, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      keyboard.off('keydown', close);
      blink.remove();
      // 이 입력으로 오디오가 열린다 (howler도 자동으로 열지만 확실히 한 번 더)
      Sfx.unlock();
      this.registry.set('soundUnlocked', true);
      Sfx.play('ui_click');
      this.tweens.add({
        targets: [dim, g, msg, hint], alpha: 0, duration: 200,
        onComplete: () => { dim.destroy(); g.destroy(); msg.destroy(); hint.destroy(); },
      });
      // 닫히는 동안 메뉴가 눌리지 않게 막아 두었다가 바로 치운다
      dim.disableInteractive();
      onClose();
    };
    dim.on('pointerup', close);
    keyboard.on('keydown', close);
  }

  private addButton(x: number, y: number, label: string, sub: string, onClick: () => void): void {
    const w = 380;
    const h = 64;
    const g = this.add.graphics();
    const draw = (hover: boolean) => {
      g.clear();
      g.fillStyle(UI.PANEL, hover ? 0.95 : 0.82).fillRoundedRect(x - w / 2, y - h / 2, w, h, 14);
      g.lineStyle(hover ? 3 : 2, UI.GOLD, hover ? 1 : 0.7).strokeRoundedRect(x - w / 2, y - h / 2, w, h, 14);
      g.fillStyle(UI.GOLD, hover ? 1 : 0.8).fillTriangle(x - w / 2 + 26, y - 9, x - w / 2 + 26, y + 9, x - w / 2 + 40, y);
    };
    draw(false);
    uiText(this, x - w / 2 + 58, y - 12, 22).setText(label).setOrigin(0, 0.5);
    uiText(this, x - w / 2 + 58, y + 14, 13, { color: UI.MUTED, bold: false }).setText(sub).setOrigin(0, 0.5);

    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => draw(true));
    zone.on('pointerout', () => draw(false));
    zone.on('pointerup', onClick);
  }

  private begin(mode: GameMode): void {
    Sfx.play('ui_click');
    this.scene.start('Game', { mode });
  }
}
