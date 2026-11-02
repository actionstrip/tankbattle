class PreloadScene extends Phaser.Scene {
  constructor() { super('Preload'); }

  preload() {
    this.load.image('bg', CONFIG.STAGE.BG);
    this.load.image('ground', CONFIG.STAGE.GROUND);
    this.load.image('tanks', 'images/tanks/tanks.png');

    const bar = this.add.rectangle(CONFIG.GAME_W / 2, CONFIG.GAME_H / 2, 1, 16, 0xfbbf24);
    this.load.on('progress', (v) => { bar.width = 600 * v; });
  }

  create() {
    this.registry.set('barrelInfo', sliceTanks(this));

    const dot = this.textures.createCanvas('dot', 32, 32);
    const grad = dot.context.createRadialGradient(16, 16, 1, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    dot.context.fillStyle = grad;
    dot.context.fillRect(0, 0, 32, 32);
    dot.refresh();

    const shell = this.textures.createCanvas('shell', 26, 14);
    const c = shell.context;
    c.fillStyle = '#20252b';
    c.beginPath();
    c.moveTo(0, 2);
    c.lineTo(15, 2);
    c.quadraticCurveTo(26, 4, 26, 7);
    c.quadraticCurveTo(26, 10, 15, 12);
    c.lineTo(0, 12);
    c.closePath();
    c.fill();
    c.fillStyle = '#fbbf24';
    c.fillRect(4, 2, 3, 10);
    shell.refresh();

    this.scene.start('Title');
  }
}
