import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { MenuScene } from './game/MenuScene';
import { H, W } from './game/ui';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#0f2418',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true },
  scene: [MenuScene, GameScene],
});
