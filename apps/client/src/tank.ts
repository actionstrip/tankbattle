// 탱크 표시. 상태·이동·낙하·포구 계산은 @fortress/shared 의 TankBody가 하고,
// 여기서는 스프라이트를 붙이고 피해·격파·반동 연출을 한다.
// (x, y)는 궤도 바닥 중앙이며, y는 밟고 있는 땅의 첫 픽셀 행이다.
import Phaser from 'phaser';
import { TankBody } from '@fortress/shared';
import { CONFIG } from './config';
import type { Player } from './config';
import type { GameScene } from './scenes/GameScene';
import { TANK_SHEET, sourceImage } from './tankSlicer';
import type { BarrelInfo } from './tankSlicer';
import type { Terrain } from './terrain';

export class Tank extends TankBody {
  readonly scene: GameScene;
  declare readonly terrain: Terrain;
  /** 발사 반동 연출 값 (0이면 평상시). kick = 뒤로 밀림·들림, pulse = 크기 출렁임 */
  private fx = { kick: 0, pulse: 0, dir: 1 };

  readonly barrel: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  readonly rig: Phaser.GameObjects.Container;
  readonly root: Phaser.GameObjects.Container;

  constructor(scene: GameScene, terrain: Terrain, player: Player, barrelInfo: BarrelInfo) {
    super(terrain, player);
    this.scene = scene;

    const S = TANK_SHEET;
    const name = player.sprite;
    const bo = barrelInfo.origin;
    this.barrel = scene.add.image(this.pivot.x, this.pivot.y, 'tank_barrel').setOrigin(bo.x, bo.y);
    // 몸체 원본 그림은 모두 같은 크기 (개인전 색은 원본 없이 레드에서 만든 것)
    const src = sourceImage(scene, `tank_${S.COLORS[0]}_body_src`);
    this.body = scene.add.image(0, 0, `tank_${name}_body`)
      .setOrigin(S.ORIGIN.x / src.width, S.ORIGIN.y / src.height);
    // 배치 시안대로 포신(고리 부분)이 몸체 위에 그려진다.
    this.rig = scene.add.container(0, 0, [this.body, this.barrel]);
    this.root = scene.add.container(this.x, this.y, [this.rig]).setDepth(CONFIG.DEPTH.TANK);
    this.syncView(1);
  }

  update(dt: number): void {
    this.step(dt);
    if (this.dead) return;
    this.syncView(Math.min(1, dt * 10));
  }

  private syncView(blend: number): void {
    this.slope += (this.targetSlope - this.slope) * blend;
    const R = CONFIG.TANK.RECOIL;
    const { kick, pulse, dir } = this.fx;
    // 반동: 쏜 반대쪽으로 밀리고, 앞쪽이 살짝 들리고, 몸 전체가 커졌다 작아진다.
    this.root.setPosition(this.x - dir * R.PUSH * kick, this.y);
    this.root.setRotation(this.slope - dir * R.TILT * kick);
    this.root.setScale(1 + R.PULSE * pulse);
    this.rig.setScale(this.rigScale * -this.facing, this.rigScale);
    // 포신은 축을 따라 뒤로 쑥 들어갔다 나온다.
    const e = Phaser.Math.DegToRad(this.elevation);
    const back = (R.BARREL * kick) / this.rigScale;
    this.barrel.setPosition(this.pivot.x + Math.cos(e) * back, this.pivot.y + Math.sin(e) * back);
    this.barrel.setRotation(e);
  }

  // 발사 반동. strength는 무기별 배율 (강력탄은 더 세게).
  recoil(dirX: number, strength = 1): void {
    const R = CONFIG.TANK.RECOIL;
    const fx = this.fx;
    this.scene.tweens.killTweensOf(fx);
    fx.dir = Math.sign(dirX) || this.facing;
    fx.kick = strength;
    fx.pulse = strength;
    this.scene.tweens.add({ targets: fx, kick: 0, duration: R.KICK_MS, ease: 'Quad.easeOut' });
    this.scene.tweens.add({ targets: fx, pulse: 0, duration: R.PULSE_MS, ease: 'Elastic.easeOut', easeParams: [1, 0.35] });
  }

  protected override onDamaged(amount: number): void {
    this.scene.onTankDamaged(this, amount);
    this.body.setTint(0xff7777);
    this.barrel.setTint(0xff7777);
    this.scene.time.delayedCall(180, () => {
      if (this.body.active) this.body.setTint(0xffffff);
      if (this.barrel.active) this.barrel.setTint(0xffffff);
    });
  }

  protected override onDied(): void {
    this.root.setVisible(false);
    this.scene.onTankDestroyed(this);
  }
}
