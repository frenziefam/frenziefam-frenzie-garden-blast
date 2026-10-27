import Phaser from 'phaser';
import { ALL_LEVELS, ENDLESS } from '../core/levels';
import { makeTextures, PALETTE } from './art';
import { button, H, loadProgress, panel, star, text, W } from './ui';

export class MenuScene extends Phaser.Scene {
  private static jumped = false;

  constructor() {
    super('menu');
  }

  preload() {
    if (!this.textures.exists('soil')) makeTextures(this);
  }

  create() {
    // ?level=b3 (with optional &seed=N) opens a level directly, once, for replays and bug reports.
    const wanted = new URLSearchParams(window.location.search).get('level');
    if (wanted && !MenuScene.jumped) {
      MenuScene.jumped = true;
      const lvl = wanted === 'endless' ? ENDLESS : ALL_LEVELS.find((l) => l.id === wanted);
      if (lvl) {
        this.scene.start('game', { level: lvl });
        return;
      }
    }
    drawBackdrop(this);
    const progress = loadProgress();

    // Decorative flowers around the title.
    const deco: [string, number, number, number][] = [
      ['sunflower-3', 110, 110, 1.1],
      ['rose-3', 610, 120, 1.0],
      ['daisy-3', 70, 270, 0.8],
      ['orchid-3', 650, 280, 0.85],
      ['tulip-3', 620, 1190, 0.8],
      ['lily-3', 100, 1190, 0.8],
    ];
    for (const [k, x, y, s] of deco) this.add.image(x, y, k).setScale(s).setAlpha(0.9);

    text(this, W / 2, 150, 'FRENZIE', 76, '#f2b928', { stroke: '#5a2e0c', strokeThickness: 10 });
    text(this, W / 2, 228, 'GARDEN BLAST', 60, '#f6eedc', { stroke: '#1f4d1a', strokeThickness: 10 });
    text(this, W / 2, 292, 'Prototype B: weeds and tools', 24, '#cfe3b4');

    panel(this, W / 2, 405, 640, 150);
    text(this, W / 2, 360, 'How to play', 26, '#f2b928');
    text(
      this,
      W / 2,
      418,
      'Pick a seed, then tap soil to plant it. Every planting grows\nyour other plants one stage. Weeds spread and choke flowers:\nblooms clear the weeds beside them, and tools help too.',
      19,
      '#f6eedc',
      { align: 'center', lineSpacing: 5 },
    );

    text(this, W / 2, 512, 'Campaign', 30, '#f6eedc');
    text(this, W / 2, 546, '1–5 garden basics · 6–13 weeds and tools', 19, '#cfe3b4');
    ALL_LEVELS.forEach((lvl, i) => {
      const x = W / 2 + (i % 2 ? 165 : -165);
      const y = 604 + Math.floor(i / 2) * 76;
      const color = lvl.id.startsWith('b') ? 0x2f6b3a : 0x3d8a2c;
      button(this, x, y, 316, 64, `${i + 1}. ${lvl.name}`, () => this.scene.start('game', { level: lvl }), color, 22);
      const got = progress.stars[lvl.id] ?? 0;
      for (let s = 0; s < 3; s++) star(this, x + 108 + s * 20, y + 22, 8, s < got);
    });

    button(this, W / 2 + 165, 1060, 316, 64, 'Endless Garden', () => this.scene.start('game', { level: ENDLESS }), 0x6a3a1c, 24);
    text(this, W / 2 + 165, 1108, progress.endlessBest ? `Best: ${progress.endlessBest.toLocaleString()}` : 'No runs yet', 18, '#cfe3b4');
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
