window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CONFIG.GAME_W,
  height: CONFIG.GAME_H,
  backgroundColor: '#0b1a2b',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [PreloadScene, TitleScene, GameScene],
});
