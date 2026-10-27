import Phaser from 'phaser';
import { LEVELS } from '../core/levels';
import { PATTERN_NAMES } from '../core/patterns';
import { randomSeed } from '../core/rng';
import { forecast, resolve, createGame } from '../core/rules';
import { BOARD_SIZE, GameEvent, GameState, LevelDef, Species } from '../core/types';
import { PALETTE, SPECIES_COLOR, SPECIES_LABEL } from './art';
import { drawBackdrop } from './MenuScene';
import { button, Button, loadProgress, panel, saveProgress, star, text, W } from './ui';

const TILE = 80;
const BOARD_X = (W - TILE * BOARD_SIZE) / 2;
const BOARD_Y = 300;
const CONVEYOR_Y = 1052;
const SLOT_X = [W / 2 - 150, W / 2, W / 2 + 150];

export class GameScene extends Phaser.Scene {
  private level!: LevelDef;
  private state!: GameState;
  private selected = 0;
  private busy = false;
  private plants: (Phaser.GameObjects.Image | null)[][] = [];
  private slotImages: Phaser.GameObjects.Image[] = [];
  private slotFrames!: Phaser.GameObjects.Graphics;
  private forecastGfx!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Image;
  private ghostFrame!: Phaser.GameObjects.Graphics;
  private hud!: {
    moves: Phaser.GameObjects.Text;
    movesLabel: Phaser.GameObjects.Text;
    score: Phaser.GameObjects.Text;
    objectives: Phaser.GameObjects.Text[];
    debug: Phaser.GameObjects.Text;
  };
  private compostBtn!: Button;
  private overlay: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('game');
  }

  init(data: { level: LevelDef; seed?: number }) {
    this.level = data.level;
    const forced = Number(new URLSearchParams(window.location.search).get('seed'));
    const seed = data.seed ?? (Number.isFinite(forced) && forced > 0 ? forced : randomSeed());
    this.state = createGame(this.level, seed);
    this.selected = 0;
    this.busy = false;
    this.overlay = null;
  }

  create() {
    drawBackdrop(this);
    this.buildHud();
    this.buildBoard();
    this.buildConveyor();
    this.buildBottomBar();
    this.refreshAll();
    this.showIntro();
    // Test hooks for automated browser checks: read-only views of the conveyor and board.
    const hooks = window as unknown as { __fgb?: () => Species[]; __fgbBoard?: () => string[] };
    hooks.__fgb = () => this.state.conveyor.slice();
    hooks.__fgbBoard = () =>
      this.state.tiles.map((row) => row.map((t) => (t.plant ? t.plant.species[0] + t.plant.stage : '..')).join(' '));
  }

  // ---------- layout ----------

  private buildHud() {
    button(this, 70, 62, 100, 64, 'Menu', () => this.scene.start('menu'), 0x6a3a1c, 24);
    text(this, W / 2, 48, this.level.name, 34, '#f6eedc', { stroke: '#0d1f12', strokeThickness: 6 });
    const sub = this.level.mode === 'endless' ? 'Endless Garden' : `Campaign · level ${LEVELS.indexOf(this.level) + 1}`;
    text(this, W / 2, 88, sub, 20, '#cfe3b4');

    panel(this, W - 80, 66, 120, 100, 0x3a2416);
    const movesLabel = text(this, W - 80, 36, this.level.mode === 'endless' ? 'Move' : 'Moves', 20, '#f2b928');
    const moves = text(this, W - 80, 78, '', 44, '#fffaf0');

    panel(this, W / 2, 196, W - 40, 150);
    const score = text(this, W - 140, 196, '', 30, '#f2b928');
    const objectives: Phaser.GameObjects.Text[] = [];
    const objs = this.objectiveRows();
    objs.forEach((o, i) => {
      const y = 150 + (objs.length === 1 ? 46 : i * 46 + 22);
      if (o.icon) this.add.image(60, y, o.icon).setScale(0.42);
      objectives.push(text(this, 90, y, '', 24, '#f6eedc').setOrigin(0, 0.5));
    });
    const debug = text(this, W / 2, 1262, '', 16, '#6f8a68');
    this.hud = { moves, movesLabel, score, objectives, debug };
  }

  private objectiveRows(): { icon?: string }[] {
    if (this.level.mode === 'endless') return [{ icon: 'daisy-3' }];
    return this.level.objectives.map((o) => {
      if (o.kind === 'score') return { icon: 'sunflower-3' };
      const bp = this.level.blueprints.find((b) => b.id === o.blueprintId)!;
      return { icon: `${bp.cells[0].species}-3` };
    });
  }

  private buildBoard() {
    const frame = this.add.graphics();
    frame.fillStyle(0x2a1a10, 1);
    frame.fillRoundedRect(BOARD_X - 14, BOARD_Y - 14, TILE * BOARD_SIZE + 28, TILE * BOARD_SIZE + 28, 24);
    frame.lineStyle(4, PALETTE.gold, 0.5);
    frame.strokeRoundedRect(BOARD_X - 14, BOARD_Y - 14, TILE * BOARD_SIZE + 28, TILE * BOARD_SIZE + 28, 24);

    const slotGfx = this.add.graphics();
    this.plants = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row: (Phaser.GameObjects.Image | null)[] = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        const { x, y } = this.tileCenter(r, c);
        const tile = this.state.tiles[r][c];
        const img = this.add.image(x, y, tile.blocked ? 'stone' : 'soil').setDisplaySize(TILE - 4, TILE - 4);
        if (!tile.blocked) {
          img.setInteractive({ useHandCursor: true });
          img.on('pointerover', () => this.showGhost(r, c));
          img.on('pointerout', () => this.hideGhost());
          img.on('pointerup', () => this.tryPlant(r, c));
        }
        if (tile.slot) {
          this.add.image(x, y, `${tile.slot.species}-3`).setScale(0.62).setAlpha(0.3);
          slotGfx.lineStyle(3, PALETTE.gold, 0.9);
          slotGfx.strokeRoundedRect(x - TILE / 2 + 5, y - TILE / 2 + 5, TILE - 10, TILE - 10, 12);
        }
        row.push(null);
      }
      this.plants.push(row);
    }
    this.forecastGfx = this.add.graphics();
    this.ghostFrame = this.add.graphics();
    this.ghost = this.add.image(0, 0, 'rose-1').setAlpha(0.55).setVisible(false).setScale(0.8);
  }

  private buildConveyor() {
    panel(this, W / 2, CONVEYOR_Y, 520, 170, 0x3a2416);
    this.slotFrames = this.add.graphics();
    this.slotImages = SLOT_X.map((x, i) => {
      this.add.image(x, CONVEYOR_Y, 'packet').setDisplaySize(124, 124);
      const img = this.add.image(x, CONVEYOR_Y - 12, `${this.state.conveyor[i]}-3`).setScale(0.85);
      const zone = this.add.zone(x, CONVEYOR_Y, 130, 140).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => this.select(i));
      return img;
    });
    this.slotLabels = SLOT_X.map((x) => text(this, x, CONVEYOR_Y + 44, '', 17, '#3a2416'));
  }
  private slotLabels: Phaser.GameObjects.Text[] = [];

  private buildBottomBar() {
    this.compostBtn = button(this, 190, 1188, 300, 72, '', () => this.compost(), 0x6a3a1c, 24);
    button(this, W - 190, 1188, 300, 72, 'Restart', () => this.restart(), 0x3d8a2c, 26);
  }

  private tileCenter(r: number, c: number) {
    return { x: BOARD_X + c * TILE + TILE / 2, y: BOARD_Y + r * TILE + TILE / 2 };
  }

  // ---------- state to screen ----------

  private refreshAll() {
    this.syncPlants();
    this.refreshHud();
    this.refreshConveyor();
    this.refreshForecast();
  }

  private syncPlants() {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = this.state.tiles[r][c].plant;
        const img = this.plants[r][c];
        if (!p) {
          img?.destroy();
          this.plants[r][c] = null;
          continue;
        }
        const key = `${p.species}-${p.stage}`;
        if (!img) {
          const { x, y } = this.tileCenter(r, c);
          this.plants[r][c] = this.add.image(x, y, key).setScale(0.8);
        } else if (img.texture.key !== key) {
          img.setTexture(key);
        }
      }
    }
    this.children.bringToTop(this.forecastGfx);
    this.children.bringToTop(this.ghostFrame);
    this.children.bringToTop(this.ghost);
  }

  private refreshHud() {
    const s = this.state;
    this.hud.moves.setText(s.movesLeft === null ? String(s.move) : String(s.movesLeft));
    this.hud.moves.setColor(s.movesLeft !== null && s.movesLeft <= 3 ? '#ff8a6a' : '#fffaf0');
    this.hud.score.setText(`Score\n${s.score.toLocaleString()}`).setAlign('center');
    if (this.level.mode === 'endless') {
      this.hud.objectives[0].setText(`Patterns ${s.stats.patterns} · combo best ${s.stats.largestCombo}`);
    } else {
      this.level.objectives.forEach((o, i) => {
        if (o.kind === 'score') {
          this.hud.objectives[i].setText(`Reach ${o.target.toLocaleString()} points`);
        } else {
          const bp = this.level.blueprints.find((b) => b.id === o.blueprintId)!;
          this.hud.objectives[i].setText(`${bp.name}  ${Math.min(s.progress[bp.id], o.count)}/${o.count}`);
        }
      });
    }
    this.compostBtn.setLabel(`Compost (${s.compostLeft})`);
    this.compostBtn.setEnabled(s.compostLeft > 0 && s.status === 'playing');
    this.hud.debug.setText(`seed ${s.seed} · move ${s.move}`);
  }

  private refreshConveyor() {
    this.slotImages.forEach((img, i) => img.setTexture(`${this.state.conveyor[i]}-3`));
    this.slotLabels.forEach((t, i) => t.setText(SPECIES_LABEL[this.state.conveyor[i]]));
    const g = this.slotFrames;
    g.clear();
    const x = SLOT_X[this.selected];
    g.lineStyle(6, PALETTE.gold, 1);
    g.strokeRoundedRect(x - 68, CONVEYOR_Y - 68, 136, 136, 16);
    g.fillStyle(PALETTE.gold, 1);
    g.fillTriangle(x - 14, CONVEYOR_Y + 80, x + 14, CONVEYOR_Y + 80, x, CONVEYOR_Y + 66);
  }

  private refreshForecast() {
    const g = this.forecastGfx;
    g.clear();
    this.tweens.killTweensOf(g);
    g.setAlpha(1);
    const cells = forecast(this.state);
    if (!cells.size) return;
    for (const k of cells) {
      const [r, c] = k.split(',').map(Number);
      const { x, y } = this.tileCenter(r, c);
      g.lineStyle(4, 0xfff1a0, 1);
      g.strokeRoundedRect(x - TILE / 2 + 3, y - TILE / 2 + 3, TILE - 6, TILE - 6, 14);
    }
    this.tweens.add({ targets: g, alpha: 0.25, duration: 600, yoyo: true, repeat: -1 });
  }

  // ---------- input ----------

  private select(i: number) {
    // Choosing a seed never changes game state, so it stays responsive while a move animates.
    if (this.overlay) return;
    this.selected = i;
    this.refreshConveyor();
    this.tweens.add({ targets: this.slotImages[i], scale: 1.08, duration: 90, yoyo: true });
  }

  private showGhost(r: number, c: number) {
    if (this.busy || this.overlay) return;
    const tile = this.state.tiles[r][c];
    if (tile.plant) return;
    const { x, y } = this.tileCenter(r, c);
    const species = this.state.conveyor[this.selected];
    this.ghost.setTexture(`${species}-1`).setPosition(x, y).setVisible(true);
    this.ghostFrame.clear();
    if (tile.slot) {
      const ok = tile.slot.species === species;
      this.ghostFrame.lineStyle(4, ok ? 0x7fe07a : 0xff5a4a, 1);
      this.ghostFrame.strokeRoundedRect(x - TILE / 2 + 2, y - TILE / 2 + 2, TILE - 4, TILE - 4, 14);
    }
  }

  private hideGhost() {
    this.ghost.setVisible(false);
    this.ghostFrame.clear();
  }

  private tryPlant(r: number, c: number) {
    if (this.busy || this.overlay || this.state.status !== 'playing') return;
    this.hideGhost();
    const { state, events } = resolve(this.state, { type: 'plant', slot: this.selected, r, c });
    if (events[0]?.type === 'rejected') {
      this.toast(events[0].reason);
      const img = this.plants[r][c];
      if (img) this.tweens.add({ targets: img, x: img.x + 6, duration: 50, yoyo: true, repeat: 2 });
      return;
    }
    this.state = state;
    this.play(events);
  }

  private compost() {
    if (this.busy || this.overlay) return;
    const { state, events } = resolve(this.state, { type: 'compost', slot: this.selected });
    if (events[0]?.type === 'rejected') return this.toast(events[0].reason);
    this.state = state;
    const img = this.slotImages[this.selected];
    this.busy = true;
    this.tweens.add({
      targets: img,
      y: CONVEYOR_Y + 40,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        img.setY(CONVEYOR_Y - 12).setAlpha(1);
        this.busy = false;
        this.slideIn(this.selected);
        this.refreshAll();
      },
    });
  }

  private restart() {
    if (this.busy) return;
    this.scene.restart({ level: this.level });
  }

  // ---------- animation from engine events ----------

  private play(events: GameEvent[]) {
    this.busy = true;
    const bursts = events.filter((e) => e.type === 'burst');
    let ended: Extract<GameEvent, { type: 'ended' }> | null = null;

    for (const e of events) {
      if (e.type === 'grew') {
        for (const p of e.plants) {
          const img = this.plants[p.r][p.c];
          if (!img) continue;
          img.setTexture(`${this.state.tiles[p.r][p.c].plant?.species ?? img.texture.key.split('-')[0]}-${p.stage}`);
          this.tweens.add({ targets: img, scale: { from: 0.95, to: 0.8 }, duration: 260, ease: 'Back.Out' });
        }
      } else if (e.type === 'planted') {
        const { x, y } = this.tileCenter(e.r, e.c);
        const img = this.add.image(x, y, `${e.species}-1`).setScale(0.2);
        this.plants[e.r][e.c] = img;
        this.tweens.add({ targets: img, scale: 0.8, duration: 220, ease: 'Back.Out' });
      } else if (e.type === 'conveyor') {
        this.time.delayedCall(120, () => this.slideIn(e.slot));
      } else if (e.type === 'ended') {
        ended = e;
      }
    }

    const burstDelay = 320;
    bursts.forEach((e, i) => {
      if (e.type !== 'burst') return;
      this.time.delayedCall(burstDelay + i * 220, () => this.bloomBurst(e.burst.cells, e.burst.species, PATTERN_NAMES[e.burst.kind], e.burst.blueprintId));
    });
    const scored = events.find((e) => e.type === 'scored');
    if (scored && scored.type === 'scored') {
      this.time.delayedCall(burstDelay + 150, () => this.scorePopup(scored.points, scored.combo, scored.multi, bursts.length));
    }

    const total = bursts.length ? burstDelay + bursts.length * 220 + 520 : 300;
    this.time.delayedCall(total, () => {
      this.busy = false;
      this.refreshAll();
      if (ended) this.time.delayedCall(350, () => this.showResult());
    });
    this.refreshHud();
  }

  private slideIn(slot: number) {
    const img = this.slotImages[slot];
    img.setTexture(`${this.state.conveyor[slot]}-3`);
    this.slotLabels[slot].setText(SPECIES_LABEL[this.state.conveyor[slot]]);
    img.setX(SLOT_X[slot] + 90).setAlpha(0);
    this.tweens.add({ targets: img, x: SLOT_X[slot], alpha: 1, duration: 250, ease: 'Cubic.Out' });
  }

  private bloomBurst(cells: { r: number; c: number }[], species: Species[], name: string, blueprintId?: string) {
    cells.forEach((cell, i) => {
      const { x, y } = this.tileCenter(cell.r, cell.c);
      const img = this.plants[cell.r][cell.c];
      this.plants[cell.r][cell.c] = null;
      const color = SPECIES_COLOR[species[i]];
      if (img) {
        this.children.bringToTop(img);
        this.tweens.add({ targets: img, scale: 1.25, alpha: 0, angle: 25, duration: 420, ease: 'Cubic.Out', onComplete: () => img.destroy() });
      }
      const ring = this.add.circle(x, y, 10).setStrokeStyle(5, PALETTE.gold, 1);
      this.tweens.add({ targets: ring, radius: 52, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + i;
        const p = this.add.image(x, y, 'petal').setTint(k % 2 ? color : PALETTE.gold).setRotation(a);
        this.tweens.add({
          targets: p,
          x: x + Math.cos(a) * (60 + (k % 3) * 18),
          y: y + Math.sin(a) * (60 + (k % 3) * 18) + 20,
          alpha: 0,
          angle: 180,
          duration: 600,
          ease: 'Cubic.Out',
          onComplete: () => p.destroy(),
        });
      }
    });
    const mid = cells.reduce((a, c) => ({ r: a.r + c.r / cells.length, c: a.c + c.c / cells.length }), { r: 0, c: 0 });
    const centre = this.tileCenter(mid.r, mid.c);
    const x = Phaser.Math.Clamp(centre.x, 160, W - 160);
    const y = Math.max(centre.y, BOARD_Y + 90);
    const label = text(this, x, y - 40, blueprintId ? 'Blueprint bloom!' : `${name}!`, 30, '#fff1a0', { stroke: '#3a2416', strokeThickness: 6 });
    this.tweens.add({ targets: label, y: y - 90, alpha: 0, duration: 900, delay: 200, onComplete: () => label.destroy() });
    this.cameras.main.shake(120, 0.003);
  }

  private scorePopup(points: number, combo: number, multi: number, count: number) {
    const extras = [combo > 1 ? `combo ×${combo}` : '', count > 1 ? `${count} patterns ×${multi}` : ''].filter(Boolean).join(' · ');
    const t = text(this, W / 2, BOARD_Y + 300, `+${points.toLocaleString()}${extras ? `\n${extras}` : ''}`, 44, '#f2b928', {
      stroke: '#2a1a10',
      strokeThickness: 8,
      align: 'center',
    });
    this.tweens.add({ targets: t, y: BOARD_Y + 200, alpha: 0, duration: 1100, ease: 'Cubic.Out', onComplete: () => t.destroy() });
  }

  private toast(msg: string) {
    const t = text(this, W / 2, CONVEYOR_Y - 150, msg, 24, '#ffd2c4', { backgroundColor: '#2a1a10cc', padding: { x: 16, y: 8 } });
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 400, onComplete: () => t.destroy() });
  }

  // ---------- overlays ----------

  private makeOverlay(height: number) {
    const c = this.add.container(0, 0);
    const shade = this.add.rectangle(W / 2, 640, W, 1280, 0x000000, 0.6).setInteractive();
    c.add(shade);
    c.add(panel(this, W / 2, 640, 600, height, 0x173a24, 0.98));
    this.overlay = c;
    return c;
  }

  private showIntro() {
    const lvl = this.level;
    const c = this.makeOverlay(560);
    c.add(text(this, W / 2, 410, lvl.name, 44, '#f2b928', { stroke: '#0d1f12', strokeThickness: 6 }));
    c.add(text(this, W / 2, 490, lvl.intro, 28, '#f6eedc', { align: 'center', wordWrap: { width: 520 } }));
    if (lvl.tip) c.add(text(this, W / 2, 600, lvl.tip, 22, '#cfe3b4', { align: 'center', wordWrap: { width: 520 }, lineSpacing: 6 }));
    const stages = ['Seed', 'Sprout', 'Bloom'];
    const sp = lvl.blueprints[0]?.cells[0].species ?? 'daisy';
    stages.forEach((s, i) => {
      const x = W / 2 - 150 + i * 150;
      c.add(this.add.image(x, 710, `${sp}-${i + 1}`).setScale(0.8));
      c.add(text(this, x, 765, s, 20, '#f6eedc'));
      if (i < 2) c.add(text(this, x + 75, 710, '→', 36, '#f2b928'));
    });
    const go = button(this, W / 2, 850, 280, 84, 'Start', () => {
      c.destroy();
      this.overlay = null;
    });
    c.add(go);
  }

  private showResult() {
    const s = this.state;
    const won = s.status === 'won';
    const endless = this.level.mode === 'endless';
    const progress = loadProgress();
    let best = false;
    if (won) progress.stars[this.level.id] = Math.max(progress.stars[this.level.id] ?? 0, s.stars);
    if (endless && s.score > progress.endlessBest) {
      progress.endlessBest = s.score;
      best = true;
    }
    saveProgress(progress);

    const c = this.makeOverlay(700);
    const title = endless ? 'Run complete' : won ? 'Garden complete!' : 'Level failed';
    c.add(text(this, W / 2, 350, title, 48, won || endless ? '#f2b928' : '#ff8a6a', { stroke: '#0d1f12', strokeThickness: 6 }));
    c.add(text(this, W / 2, 415, s.endReason ?? '', 24, '#cfe3b4', { align: 'center', wordWrap: { width: 520 } }));
    if (won) for (let i = 0; i < 3; i++) c.add(star(this, W / 2 - 90 + i * 90, 500, 36, i < s.stars));
    const lines = endless
      ? [
          `Score ${s.score.toLocaleString()}${best ? ' (new best!)' : ''}`,
          `Patterns ${s.stats.patterns} · flowers grown ${s.stats.flowersGrown}`,
          `Moves ${s.move} · largest combo ${s.stats.largestCombo}`,
        ]
      : [
          `Score ${s.score.toLocaleString()}`,
          won ? `Coins this level: ${(50 + s.coins).toLocaleString()}` : 'A life would be used here (lives arrive in Prototype C).',
          s.bloomed.length ? `Bloomed: ${s.bloomed.map((b) => SPECIES_LABEL[b]).join(', ')}` : 'No patterns bloomed.',
        ];
    lines.forEach((l, i) => c.add(text(this, W / 2, 590 + i * 46, l, 26, '#f6eedc', { align: 'center', wordWrap: { width: 540 } })));
    if (won) c.add(text(this, W / 2, 735, 'Plant card choice comes in Prototype C.', 20, '#9fbf92'));

    const idx = LEVELS.indexOf(this.level);
    const next = won && idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
    if (next) {
      c.add(button(this, W / 2, 830, 360, 80, 'Next level', () => this.scene.start('game', { level: next })));
      c.add(button(this, W / 2 - 100, 925, 180, 70, 'Replay', () => this.restart(), 0x6a3a1c, 24));
      c.add(button(this, W / 2 + 100, 925, 180, 70, 'Menu', () => this.scene.start('menu'), 0x6a3a1c, 24));
    } else {
      c.add(button(this, W / 2, 830, 360, 80, won || endless ? 'Play again' : 'Try again', () => this.restart()));
      c.add(button(this, W / 2, 925, 360, 70, 'Menu', () => this.scene.start('menu'), 0x6a3a1c, 24));
    }
  }
}

