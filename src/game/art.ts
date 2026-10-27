// Procedural placeholder art, drawn once at boot into textures. Each species has its own
// silhouette as well as its own colour, so the board stays readable without colour (GDD I3).

import Phaser from 'phaser';
import { ALL_SPECIES, Species } from '../core/types';

export const TEX = 96;

export const PALETTE = {
  forest: 0x0f2418,
  emerald: 0x1f6b3a,
  olive: 0x5d6b2a,
  leaf: 0x4f9a35,
  soil: 0x5a3a26,
  soilDark: 0x3f281b,
  charcoal: 0x23232a,
  gold: 0xe7b23a,
  amber: 0xd98a2b,
  orange: 0xe0702c,
  red: 0xc8283a,
  violet: 0x7a3fb0,
  blue: 0x3f78b8,
  weed: 0x8fd13f,
  cream: 0xf6eedc,
};

export const SPECIES_COLOR: Record<Species, number> = {
  rose: 0xd2233a,
  daisy: 0xf7f4ea,
  sunflower: 0xf2b928,
  tulip: 0xf0702a,
  lily: 0xf6d3e2,
  orchid: 0xa04ad0,
};

export const SPECIES_LABEL: Record<Species, string> = {
  rose: 'Rose',
  daisy: 'Daisy',
  sunflower: 'Sunflower',
  tulip: 'Tulip',
  lily: 'Lily',
  orchid: 'Orchid',
};

type G = Phaser.GameObjects.Graphics;

/** Fills a petal: an ellipse rotated by `angle`, its near end at distance `inner` from the centre. */
function petal(g: G, cx: number, cy: number, angle: number, inner: number, length: number, width: number) {
  const pts: Phaser.Math.Vector2[] = [];
  const mid = inner + length / 2;
  for (let i = 0; i < 20; i++) {
    const t = (i / 20) * Math.PI * 2;
    const x = Math.cos(t) * (length / 2) + mid;
    const y = Math.sin(t) * (width / 2);
    pts.push(new Phaser.Math.Vector2(cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)));
  }
  g.fillPoints(pts, true);
}

function darken(color: number, f: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  return Phaser.Display.Color.GetColor(c.red * f, c.green * f, c.blue * f);
}

function leaves(g: G, cx: number, cy: number, size: number) {
  g.fillStyle(PALETTE.leaf, 1);
  petal(g, cx, cy, -Math.PI * 0.85, 0, size, size * 0.45);
  petal(g, cx, cy, -Math.PI * 0.15, 0, size, size * 0.45);
  g.fillStyle(darken(PALETTE.leaf, 0.75), 1);
  g.fillRect(cx - 2, cy - 4, 4, 22);
}

function drawMature(g: G, s: Species) {
  const cx = TEX / 2;
  const cy = TEX / 2;
  const col = SPECIES_COLOR[s];
  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(cx, cy + 34, 52, 12);
  switch (s) {
    case 'rose': {
      // Round, layered bloom.
      for (const [r, f] of [[34, 0.55], [28, 0.8], [21, 1], [14, 0.75], [8, 0.55]] as const) {
        g.fillStyle(darken(col, f), 1);
        g.fillCircle(cx, cy, r);
      }
      g.lineStyle(2, darken(col, 0.45), 0.8);
      g.beginPath();
      g.arc(cx, cy, 18, 0.3, 2.6);
      g.strokePath();
      g.beginPath();
      g.arc(cx, cy, 11, 3.4, 5.6);
      g.strokePath();
      break;
    }
    case 'daisy': {
      // Many thin petals, small yellow centre.
      g.fillStyle(0xd9d3c3, 1);
      for (let i = 0; i < 14; i++) petal(g, cx, cy, (i / 14) * Math.PI * 2 + 0.11, 8, 32, 11);
      g.fillStyle(col, 1);
      for (let i = 0; i < 14; i++) petal(g, cx, cy, (i / 14) * Math.PI * 2, 8, 30, 9);
      g.fillStyle(0xf2b928, 1);
      g.fillCircle(cx, cy, 11);
      g.fillStyle(0xc98a10, 1);
      g.fillCircle(cx + 2, cy + 2, 6);
      break;
    }
    case 'sunflower': {
      // Pointed gold petals, large dark centre.
      g.fillStyle(darken(col, 0.75), 1);
      for (let i = 0; i < 18; i++) petal(g, cx, cy, (i / 18) * Math.PI * 2 + 0.17, 14, 26, 10);
      g.fillStyle(col, 1);
      for (let i = 0; i < 18; i++) petal(g, cx, cy, (i / 18) * Math.PI * 2, 14, 24, 9);
      g.fillStyle(0x5a3416, 1);
      g.fillCircle(cx, cy, 17);
      g.fillStyle(0x3a210d, 1);
      for (let i = 0; i < 10; i++) g.fillCircle(cx + Math.cos(i * 2.4) * (i * 1.4), cy + Math.sin(i * 2.4) * (i * 1.4), 2);
      break;
    }
    case 'tulip': {
      // Tall cup on a stem.
      g.fillStyle(darken(PALETTE.leaf, 0.8), 1);
      g.fillRect(cx - 3, cy + 6, 6, 30);
      g.fillStyle(PALETTE.leaf, 1);
      petal(g, cx, cy + 30, -Math.PI * 0.75, 0, 26, 10);
      g.fillStyle(darken(col, 0.7), 1);
      g.fillPoints([
        new Phaser.Math.Vector2(cx - 24, cy - 22),
        new Phaser.Math.Vector2(cx - 12, cy - 6),
        new Phaser.Math.Vector2(cx, cy - 30),
        new Phaser.Math.Vector2(cx + 12, cy - 6),
        new Phaser.Math.Vector2(cx + 24, cy - 22),
        new Phaser.Math.Vector2(cx + 22, cy + 4),
        new Phaser.Math.Vector2(cx, cy + 14),
        new Phaser.Math.Vector2(cx - 22, cy + 4),
      ], true);
      g.fillStyle(col, 1);
      g.fillPoints([
        new Phaser.Math.Vector2(cx - 18, cy - 16),
        new Phaser.Math.Vector2(cx - 8, cy - 4),
        new Phaser.Math.Vector2(cx, cy - 24),
        new Phaser.Math.Vector2(cx + 8, cy - 4),
        new Phaser.Math.Vector2(cx + 18, cy - 16),
        new Phaser.Math.Vector2(cx + 16, cy + 2),
        new Phaser.Math.Vector2(cx, cy + 10),
        new Phaser.Math.Vector2(cx - 16, cy + 2),
      ], true);
      break;
    }
    case 'lily': {
      // Six long pointed petals: a star.
      g.fillStyle(0xe4a3c0, 1);
      for (let i = 0; i < 6; i++) petal(g, cx, cy, (i / 6) * Math.PI * 2 - Math.PI / 2, 2, 38, 15);
      g.fillStyle(col, 1);
      for (let i = 0; i < 6; i++) petal(g, cx, cy, (i / 6) * Math.PI * 2 - Math.PI / 2, 4, 33, 11);
      g.fillStyle(0xd0567f, 1);
      for (let i = 0; i < 6; i++) petal(g, cx, cy, (i / 6) * Math.PI * 2 - Math.PI / 2, 4, 14, 3);
      g.fillStyle(0xe7b23a, 1);
      for (let i = 0; i < 5; i++) g.fillCircle(cx + Math.cos(i * 1.25) * 9, cy + Math.sin(i * 1.25) * 9, 2.5);
      break;
    }
    case 'orchid': {
      // Two wide side petals, a narrow top, and a big lower lip.
      g.fillStyle(darken(col, 0.7), 1);
      petal(g, cx, cy, -Math.PI / 2, 0, 30, 14);
      petal(g, cx, cy, -Math.PI * 0.12, 0, 34, 26);
      petal(g, cx, cy, -Math.PI * 0.88, 0, 34, 26);
      g.fillStyle(col, 1);
      petal(g, cx, cy, -Math.PI * 0.12, 2, 30, 22);
      petal(g, cx, cy, -Math.PI * 0.88, 2, 30, 22);
      g.fillStyle(0xc77ee8, 1);
      petal(g, cx, cy, Math.PI / 2, 0, 30, 26);
      g.fillStyle(0xf2d45c, 1);
      g.fillCircle(cx, cy + 4, 6);
      break;
    }
  }
}

function drawSprout(g: G, s: Species) {
  const cx = TEX / 2;
  const cy = TEX / 2 + 6;
  g.fillStyle(PALETTE.soilDark, 1);
  g.fillEllipse(cx, cy + 26, 44, 14);
  leaves(g, cx, cy + 18, 30);
  g.fillStyle(darken(PALETTE.leaf, 0.75), 1);
  g.fillRect(cx - 2, cy - 12, 4, 30);
  // The bud shows the species colour and a hint of its shape.
  const col = SPECIES_COLOR[s];
  g.fillStyle(darken(col, 0.7), 1);
  petal(g, cx, cy - 10, -Math.PI / 2, 0, 24, 18);
  g.fillStyle(col, 1);
  petal(g, cx, cy - 10, -Math.PI / 2, 2, 19, 13);
  g.fillStyle(PALETTE.leaf, 1);
  petal(g, cx, cy - 8, -Math.PI * 0.62, 0, 12, 7);
  petal(g, cx, cy - 8, -Math.PI * 0.38, 0, 12, 7);
}

function drawSeed(g: G, s: Species) {
  const cx = TEX / 2;
  const cy = TEX / 2 + 10;
  g.fillStyle(PALETTE.soilDark, 1);
  g.fillEllipse(cx, cy + 8, 50, 20);
  g.fillStyle(0x6e4a30, 1);
  g.fillEllipse(cx, cy + 4, 40, 16);
  g.fillStyle(0x8a6040, 1);
  g.fillEllipse(cx, cy, 18, 24);
  g.fillStyle(SPECIES_COLOR[s], 1);
  g.fillCircle(cx, cy - 4, 5);
}

/** Conveyor packet: the mature flower on a seed packet card. */
function drawPacket(g: G) {
  g.fillStyle(0xe9dcc0, 1);
  g.fillRoundedRect(4, 4, TEX - 8, TEX - 8, 12);
  g.lineStyle(3, 0x9a7a4a, 1);
  g.strokeRoundedRect(4, 4, TEX - 8, TEX - 8, 12);
}

// ---------- weeds, nests and tools (Prototype B) ----------
// Creeping vines are green, curling and leafy. Aggressive weeds are dark red and thorny. The two
// differ in shape as well as colour, so they stay distinct without colour vision (GDD I3).

function vine(g: G, cx: number, cy: number, leaf: number, stem: number, scale = 1) {
  g.lineStyle(5 * scale, stem, 1);
  g.beginPath();
  g.arc(cx - 10 * scale, cy + 6 * scale, 16 * scale, -0.4, 2.6);
  g.strokePath();
  g.beginPath();
  g.arc(cx + 12 * scale, cy - 6 * scale, 14 * scale, 2.8, 5.8);
  g.strokePath();
  g.fillStyle(leaf, 1);
  for (const [a, d] of [[0.2, 22], [1.3, 18], [2.4, 24], [3.4, 20], [4.4, 23], [5.4, 17]] as const) {
    petal(g, cx, cy, a, d * scale * 0.55, 18 * scale, 9 * scale);
  }
  g.fillStyle(darken(leaf, 0.7), 1);
  g.fillCircle(cx, cy, 5 * scale);
}

function thorns(g: G, cx: number, cy: number, fill: number, dark: number, scale = 1) {
  g.lineStyle(6 * scale, dark, 1);
  g.lineBetween(cx - 26 * scale, cy + 20 * scale, cx + 24 * scale, cy - 22 * scale);
  g.lineBetween(cx - 24 * scale, cy - 18 * scale, cx + 22 * scale, cy + 22 * scale);
  g.fillStyle(fill, 1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r1 = 12 * scale;
    const r2 = 32 * scale;
    g.fillTriangle(
      cx + Math.cos(a - 0.22) * r1, cy + Math.sin(a - 0.22) * r1,
      cx + Math.cos(a + 0.22) * r1, cy + Math.sin(a + 0.22) * r1,
      cx + Math.cos(a) * r2, cy + Math.sin(a) * r2,
    );
  }
  g.fillStyle(dark, 1);
  g.fillCircle(cx, cy, 13 * scale);
  g.fillStyle(fill, 1);
  g.fillCircle(cx, cy, 7 * scale);
}

function drawNest(g: G) {
  const cx = TEX / 2;
  const cy = TEX / 2 + 6;
  g.fillStyle(0x000000, 0.3);
  g.fillEllipse(cx, cy + 26, 76, 20);
  g.lineStyle(6, 0x4a2a14, 1);
  for (const a of [0.3, 1.2, 2.0, 2.9, 3.6]) g.lineBetween(cx, cy + 4, cx + Math.cos(a) * 40, cy + 4 + Math.sin(a) * 26);
  g.fillStyle(0x3a2212, 1);
  g.fillEllipse(cx, cy, 64, 42);
  g.fillStyle(0x55331b, 1);
  g.fillEllipse(cx, cy - 4, 52, 30);
  g.fillStyle(0x120a05, 1);
  g.fillEllipse(cx, cy - 6, 26, 14);
  g.fillStyle(0x8fd13f, 1);
  petal(g, cx - 6, cy - 8, -2.2, 0, 18, 7);
  petal(g, cx + 6, cy - 8, -0.9, 0, 18, 7);
}

function drawTool(g: G, kind: string) {
  const cx = TEX / 2;
  const cy = TEX / 2;
  if (kind === 'pull') {
    // A weed lifted out of the soil, roots showing.
    g.fillStyle(PALETTE.soilDark, 1);
    g.fillEllipse(cx, cy + 32, 60, 16);
    g.lineStyle(3, 0xd9c3a0, 1);
    for (const dx of [-8, 0, 8]) g.lineBetween(cx, cy + 4, cx + dx, cy + 22);
    g.fillStyle(PALETTE.weed, 1);
    for (const a of [-2.4, -1.57, -0.74]) petal(g, cx, cy, a, 2, 30, 12);
    g.fillStyle(PALETTE.cream, 1);
    g.fillTriangle(cx + 26, cy - 30, cx + 16, cy - 14, cx + 36, cy - 14);
    g.fillRect(cx + 23, cy - 16, 6, 18);
  } else if (kind === 'spray') {
    // Spray bottle with a mist cloud.
    g.fillStyle(0x3f78b8, 1);
    g.fillRoundedRect(cx - 16, cy - 6, 30, 40, 8);
    g.fillStyle(0xd9e8f6, 1);
    g.fillRect(cx - 8, cy - 18, 14, 14);
    g.fillRect(cx - 2, cy - 22, 22, 6);
    g.fillStyle(0xbfe3ff, 0.9);
    for (const [dx, dy, r] of [[30, -24, 5], [36, -14, 4], [28, -34, 3], [40, -28, 3]] as const) g.fillCircle(cx + dx, cy + dy, r);
  } else if (kind === 'burn') {
    // Flame.
    g.fillStyle(0xc8283a, 1);
    petal(g, cx, cy + 30, -Math.PI / 2, 0, 66, 44);
    g.fillStyle(0xe0702c, 1);
    petal(g, cx, cy + 30, -Math.PI / 2, 0, 50, 32);
    g.fillStyle(0xf2b928, 1);
    petal(g, cx, cy + 30, -Math.PI / 2, 0, 30, 18);
  } else {
    // Compost bin.
    g.fillStyle(0x6a4630, 1);
    g.fillRoundedRect(cx - 26, cy - 14, 52, 46, 6);
    g.fillStyle(0x8a6040, 1);
    g.fillRoundedRect(cx - 30, cy - 22, 60, 12, 4);
    g.lineStyle(3, 0x3f281b, 1);
    for (const dx of [-12, 0, 12]) g.lineBetween(cx + dx, cy - 4, cx + dx, cy + 24);
    g.fillStyle(PALETTE.leaf, 1);
    petal(g, cx, cy - 22, -2.0, 0, 20, 9);
    petal(g, cx, cy - 22, -1.0, 0, 20, 9);
  }
}

export function makeWeedTextures(scene: Phaser.Scene) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const bake = (key: string, draw: () => void) => {
    g.clear();
    draw();
    g.generateTexture(key, TEX, TEX);
  };
  bake('weed-creeping', () => {
    g.fillStyle(0x2b4a1c, 1);
    g.fillRoundedRect(4, 4, TEX - 8, TEX - 8, 14);
    vine(g, TEX / 2, TEX / 2, PALETTE.weed, 0x3f7a22);
  });
  bake('weed-aggressive', () => {
    g.fillStyle(0x3a1218, 1);
    g.fillRoundedRect(4, 4, TEX - 8, TEX - 8, 14);
    thorns(g, TEX / 2, TEX / 2, 0xe0405a, 0x6a1020);
  });
  // Overlays drawn on top of an infested plant: vines (or thorns) wrapping its edges.
  bake('infest-creeping', () => {
    for (const [x, y] of [[18, 20], [78, 22], [20, 78], [76, 76]] as const) vine(g, x, y, PALETTE.weed, 0x3f7a22, 0.45);
    g.lineStyle(4, 0x3f7a22, 1);
    g.strokeRoundedRect(8, 8, TEX - 16, TEX - 16, 16);
  });
  bake('infest-aggressive', () => {
    for (const [x, y] of [[18, 20], [78, 22], [20, 78], [76, 76]] as const) thorns(g, x, y, 0xe0405a, 0x6a1020, 0.4);
    g.lineStyle(4, 0x6a1020, 1);
    g.strokeRoundedRect(8, 8, TEX - 16, TEX - 16, 16);
  });
  bake('nest', () => drawNest(g));
  for (const k of ['pull', 'spray', 'burn', 'compost']) bake(`tool-${k}`, () => drawTool(g, k));
  bake('leaf', () => {
    g.fillStyle(0xffffff, 1);
    petal(g, TEX / 2 - 12, TEX / 2, 0, 0, 24, 10);
  });
  g.destroy();
}

export function makeTextures(scene: Phaser.Scene) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const bake = (key: string, draw: () => void, w = TEX, h = TEX) => {
    g.clear();
    draw();
    g.generateTexture(key, w, h);
  };

  for (const s of ALL_SPECIES) {
    bake(`${s}-1`, () => drawSeed(g, s));
    bake(`${s}-2`, () => drawSprout(g, s));
    bake(`${s}-3`, () => drawMature(g, s));
  }
  bake('packet', () => drawPacket(g));

  bake('soil', () => {
    g.fillStyle(PALETTE.soilDark, 1);
    g.fillRoundedRect(0, 0, TEX, TEX, 14);
    g.fillStyle(PALETTE.soil, 1);
    g.fillRoundedRect(3, 3, TEX - 6, TEX - 6, 12);
    g.fillStyle(0x6a4630, 1);
    for (let i = 0; i < 18; i++) g.fillCircle(10 + ((i * 37) % 76), 10 + ((i * 53) % 76), 2 + (i % 3));
  });
  bake('stone', () => {
    g.fillStyle(0x17171c, 1);
    g.fillRoundedRect(0, 0, TEX, TEX, 14);
    g.fillStyle(PALETTE.charcoal, 1);
    g.fillRoundedRect(4, 4, TEX - 8, TEX - 8, 12);
    g.fillStyle(0x2f3a2a, 1);
    petal(g, 24, 70, -0.6, 0, 26, 10);
    petal(g, 70, 30, 2.4, 0, 22, 8);
  });
  bake('spark', () => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
  }, 16, 16);
  bake('petal', () => {
    g.fillStyle(0xffffff, 1);
    petal(g, 4, 8, 0, 0, 20, 10);
  }, 26, 16);
  g.destroy();
  makeWeedTextures(scene);
}
