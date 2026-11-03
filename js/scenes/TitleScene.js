class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    addFixedBackground(this);

    // 맵 전체가 보이도록 땅을 화면 폭에 맞춰 하단 정렬로 깐다.
    const ground = this.textures.get('ground').getSourceImage();
    this.add.image(0, H, 'ground').setOrigin(0, 1).setScale(W / ground.width);
    this.add.rectangle(0, 0, W, H, 0x0b1a2b, 0.45).setOrigin(0);

    // 로고: 살짝 위아래로 떠 있는 느낌
    const logoSrc = this.textures.get('logo').getSourceImage();
    const logo = this.add.image(W / 2, 200, 'logo').setScale(600 / logoSrc.width);
    this.tweens.add({ targets: logo, y: 190, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.addButton(W / 2, 418, '1P  vs  CPU', '혼자서 CPU와 1:1 대결', () => this.begin('cpu'));
    this.addButton(W / 2, 496, '2P  핫시트', '한 키보드로 둘이 번갈아', () => this.begin('2p'));
    this.addButton(W / 2, 574, '2:2  팀전', '블루팀 2명 vs CPU 2대', () => this.begin('2v2'));

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
  }

  addButton(x, y, label, sub, onClick) {
    const w = 380;
    const h = 64;
    const g = this.add.graphics();
    const draw = (hover) => {
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

  begin(mode) {
    this.scene.start('Game', { mode });
  }
}
