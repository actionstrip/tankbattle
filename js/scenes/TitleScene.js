class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    addFixedBackground(this);

    // 맵 전체가 보이도록 땅을 화면 폭에 맞춰 하단 정렬로 깐다.
    const ground = this.textures.get('ground').getSourceImage();
    this.add.image(0, H, 'ground').setOrigin(0, 1).setScale(W / ground.width);
    this.add.rectangle(0, 0, W, H, 0x0b1a2b, 0.4).setOrigin(0);

    this.add.text(W / 2, 190, '포트리스', {
      fontFamily: CONFIG.FONT, fontSize: '100px', fontStyle: 'bold',
      color: '#fde047', stroke: '#0b1a2b', strokeThickness: 12,
    }).setOrigin(0.5);

    this.addButton(W / 2, 360, '1P  vs  CPU', () => this.begin('cpu'));
    this.addButton(W / 2, 455, '2P  핫시트', () => this.begin('2p'));

    this.add.text(W / 2, 580, '←→ 이동    ↑↓ 각도    Space 누르고 떼기 발사    1·2·3 무기', {
      fontFamily: CONFIG.FONT, fontSize: '22px', color: '#ffffff',
      stroke: '#0b1a2b', strokeThickness: 6,
    }).setOrigin(0.5);
  }

  addButton(x, y, label, onClick) {
    const bg = this.add.rectangle(x, y, 340, 70, 0x2563eb).setStrokeStyle(4, 0xffffff);
    this.add.text(x, y, label, {
      fontFamily: CONFIG.FONT, fontSize: '30px', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x3b82f6));
    bg.on('pointerout', () => bg.setFillStyle(0x2563eb));
    bg.on('pointerup', onClick);
  }

  begin(mode) {
    this.scene.start('Game', { mode });
  }
}
