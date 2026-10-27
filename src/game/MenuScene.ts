import Phaser from 'phaser';
import { ENDLESS, LEVELS } from '../core/levels';
import { makeTextures, PALETTE } from './art';
import { button, H, loadProgress, panel, star, text, W } from './ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  preload() {
    if (!this.textures.exists('soil')) makeTextures(this);
  }

  create() {
    drawBackdrop(this);
    const progress = loadProgress();

    // Decorative flowers around the title.
    const deco: [string, number, number, number][] = [
      ['sunflower-3', 110, 110, 1.1],
      ['rose-3', 610, 120, 1.0],
      ['daisy-3', 70, 270, 0.8],
      ['orchid-3', 650, 280, 0.85],
      ['tulip-3', 600, 1170, 0.9],
      ['lily-3', 120, 1180, 0.9],
    ];
    for (const [k, x, y, s] of deco) this.add.image(x, y, k).setScale(s).setAlpha(0.9);

    text(this, W / 2, 150, 'FRENZIE', 76, '#f2b928', { stroke: '#5a2e0c', strokeThickness: 10 });
    text(this, W / 2, 228, 'GARDEN BLAST', 60, '#f6eedc', { stroke: '#1f4d1a', strokeThickness: 10 });
    text(this, W / 2, 292, 'Prototype A: core puzzle', 24, '#cfe3b4');

    panel(this, W / 2, 410, 620, 140);
    text(this, W / 2, 372, 'How to play', 26, '#f2b928');
    text(this, W / 2, 422, 'Pick a seed, then tap soil to plant it. Every planting\ngrows your other plants one stage: seed, sprout, bloom.', 21, '#f6eedc', { align: 'center', lineSpacing: 6 });

    text(this, W / 2, 530, 'Campaign', 30, '#f6eedc');
    LEVELS.forEach((lvl, i) => {
      const y = 600 + i * 100;
      button(this, W / 2 - 60, y, 460, 80, `${i + 1}. ${lvl.name}`, () => this.scene.start('game', { level: lvl }), 0x3d8a2c, 28);
      const got = progress.stars[lvl.id] ?? 0;
      for (let s = 0; s < 3; s++) star(this, W / 2 + 225 + s * 40, y, 16, s < got);
    });

    button(this, W / 2, 1110, 460, 84, 'Endless Garden', () => this.scene.start('game', { level: ENDLESS }), 0x6a3a1c, 30);
    text(this, W / 2, 1170, progress.endlessBest ? `Best score: ${progress.endlessBest.toLocaleString()}` : 'No runs yet', 22, '#cfe3b4');
    text(this, W / 2, 1245, 'Frenzie Fam Games · prototype build, placeholder art', 18, '#7f9a78');
  }
}

export function drawBackdrop(scene: Phaser.Scene) {
  const g = scene.add.graphics();
  g.fillGradientStyle(0x14361f, 0x14361f, PALETTE.forest, PALETTE.forest, 1);
  g.fillRect(0, 0, W, H);
  g.fillStyle(0x1f4d2a, 0.35);
  for (let i = 0; i < 14; i++) g.fillCircle((i * 137) % W, (i * 271) % H, 40 + (i % 4) * 25);
}
