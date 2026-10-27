// Small UI helpers shared by the scenes.

import Phaser from 'phaser';
import { PALETTE } from './art';

export const W = 720;
export const H = 1280;
export const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

export function text(
  scene: Phaser.Scene,
  x: number,
  y: number,
  value: string,
  size = 28,
  color = '#f6eedc',
  opts: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {},
) {
  return scene.add
    .text(x, y, value, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      color,
      fontStyle: 'bold',
      resolution: 2,
      ...opts,
    })
    .setOrigin(0.5);
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fill = 0x173a24, alpha = 0.92) {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.35);
  g.fillRoundedRect(x - w / 2 + 3, y - h / 2 + 6, w, h, 20);
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 20);
  g.lineStyle(3, PALETTE.gold, 0.55);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 20);
  return g;
}

export interface Button extends Phaser.GameObjects.Container {
  setLabel(v: string): void;
  setEnabled(v: boolean): void;
}

export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  color: number = 0x3d8a2c,
  size = 30,
): Button {
  const c = scene.add.container(x, y) as Button;
  const g = scene.add.graphics();
  const draw = (fill: number) => {
    g.clear();
    const dark = Phaser.Display.Color.IntegerToColor(fill).darken(30).color;
    g.fillStyle(dark, 1);
    g.fillRoundedRect(-w / 2, -h / 2 + 5, w, h, 18);
    g.fillStyle(fill, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
    g.fillStyle(0xffffff, 0.12);
    g.fillRoundedRect(-w / 2 + 6, -h / 2 + 4, w - 12, h * 0.38, 12);
    g.lineStyle(3, PALETTE.gold, 0.85);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
  };
  draw(color);
  const t = text(scene, 0, -1, label, size, '#fffaf0', { stroke: '#1d2a14', strokeThickness: 4 });
  const zone = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
  let enabled = true;
  zone.on('pointerdown', () => enabled && scene.tweens.add({ targets: c, scale: 0.95, duration: 60, yoyo: true }));
  zone.on('pointerup', () => enabled && onClick());
  c.add([g, t, zone]);
  c.setLabel = (v: string) => t.setText(v);
  c.setEnabled = (v: boolean) => {
    enabled = v;
    c.setAlpha(v ? 1 : 0.45);
  };
  return c;
}

/** Five-point star polygon, filled or hollow. */
export function star(scene: Phaser.Scene, x: number, y: number, r: number, filled: boolean) {
  const g = scene.add.graphics({ x, y });
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(new Phaser.Math.Vector2(Math.cos(a) * rad, Math.sin(a) * rad));
  }
  g.fillStyle(filled ? PALETTE.gold : 0x2b3a2b, 1);
  g.fillPoints(pts, true);
  g.lineStyle(3, filled ? 0xfff1b8 : 0x55684f, 1);
  g.strokePoints(pts, true);
  return g;
}

// Progress is kept in browser storage for the prototype only. Prototype C replaces it with the real save system.
const KEY = 'fgb-proto-a';
export interface Progress {
  stars: Record<string, number>;
  endlessBest: number;
}
export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { stars: {}, endlessBest: 0, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { stars: {}, endlessBest: 0 };
}
export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}
