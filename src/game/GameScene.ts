import Phaser from 'phaser';
import { ALL_LEVELS } from '../core/levels';
import { PATTERN_NAMES } from '../core/patterns';
import { randomSeed } from '../core/rng';
import { createGame, forecast, hasAggressive, movesUntilCreep, plantable, resolve, toolArea } from '../core/rules';
import { BOARD_SIZE, Cell, GameEvent, GameState, LevelDef, Species, ToolKind, WeedType } from '../core/types';
import { CHOKE_LIMIT, countNests, countWeeds, DEFAULT_NEST_INTERVAL, isProtected } from '../core/weeds';
import { PALETTE, SPECIES_COLOR, SPECIES_LABEL, TEX } from './art';
import { drawBackdrop } from './MenuScene';
import { button, loadProgress, panel, saveProgress, star, text, W } from './ui';

const TILE = 80;
const BOARD_X = (W - TILE * BOARD_SIZE) / 2;
const BOARD_Y = 300;
const CONVEYOR_Y = 1052;
const SLOT_X = [W / 2 - 150, W / 2, W / 2 + 150];
const TOOLBAR_Y = 1196;
const TICK_MS = 250;
const WEED_SCALE = (TILE - 4) / TEX;
const WEED_COLOR: Record<WeedType, number> = { creeping: 0x8fd13f, aggressive: 0xe0405a };
const TOOL_NAME: Record<ToolKind, string> = { pull: 'Pull Weeds', spray: 'Weed Spray', burn: 'Controlled Burn' };
const TOOL_HELP: Record<ToolKind, string> = {
  pull: 'Tap a weed or an infested flower.',
  spray: 'Tap the middle of the 3×3 area to spray.',
  burn: 'Tap a tile in the row or column to burn.',
};

type Img = Phaser.GameObjects.Image;

interface ToolButton {
  box: Phaser.GameObjects.Container;
  count: Phaser.GameObjects.Text;
  draw: (active: boolean, enabled: boolean) => void;
  enabled: boolean;
}

export class GameScene extends Phaser.Scene {
  private level!: LevelDef;
  private state!: GameState;
  private selected = 0;
  private busy = false;
  private overlay: Phaser.GameObjects.Container | null = null;
  private tickAcc = 0;

  // Board layers, back to front.
  private weedLayer!: Phaser.GameObjects.Container;
  private plantLayer!: Phaser.GameObjects.Container;
  private overLayer!: Phaser.GameObjects.Container;
  private plants: (Img | null)[][] = [];
  private weeds: (Img | null)[][] = [];
  private infest: (Img | null)[][] = [];
  private nests: (Phaser.GameObjects.Container | null)[][] = [];
  /** Short-lived sprites from animations, replaced by the real ones on the next sync. */
  private temps: Phaser.GameObjects.GameObject[] = [];
  private protectGfx!: Phaser.GameObjects.Graphics;
  private telegraphGfx!: Phaser.GameObjects.Graphics;
  private forecastGfx!: Phaser.GameObjects.Graphics;
  private previewGfx!: Phaser.GameObjects.Graphics;
  private ghost!: Img;
  private ghostFrame!: Phaser.GameObjects.Graphics;

  private slotImages: Img[] = [];
  private slotLabels: Phaser.GameObjects.Text[] = [];
  private slotFrames!: Phaser.GameObjects.Graphics;

  private hud!: {
    moves: Phaser.GameObjects.Text;
    score: Phaser.GameObjects.Text;
    objectives: Phaser.GameObjects.Text[];
    creepIcon: Img;
    creep: Phaser.GameObjects.Text;
    aggroIcon: Img;
    aggro: Phaser.GameObjects.Text;
    debug: Phaser.GameObjects.Text;
  };

  // Tools: pick a tool, tap a target to preview it, then tap again (or press Use) to confirm.
  private toolButtons: Partial<Record<ToolKind | 'compost', ToolButton>> = {};
  private tool: ToolKind | null = null;
  private target: Cell | null = null;
  private axis: 'row' | 'col' = 'row';
  private toolPanel: Phaser.GameObjects.Container | null = null;

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
    this.tickAcc = 0;
    this.temps = [];
    this.toolButtons = {};
    this.tool = null;
    this.target = null;
    this.axis = 'row';
    this.toolPanel = null;
  }

  create() {
    drawBackdrop(this);
    this.buildHud();
    this.buildBoard();
    this.buildConveyor();
    this.buildToolbar();
    this.refreshAll();
    this.showIntro();
    // Test hooks for automated browser checks: read-only views of the game state.
    const hooks = window as unknown as Record<string, unknown>;
    hooks.__fgb = () => this.state.conveyor.slice();
    hooks.__fgbBoard = () =>
      this.state.tiles.map((row) =>
        row
          .map((t) => {
            if (t.blocked) return '##';
            if (t.nest) return `N${t.nest.hp}`;
            if (t.weed) return t.weed === 'creeping' ? 'wc' : 'wa';
            if (t.plant) return t.plant.species[0] + t.plant.stage + (t.plant.infested ? '!' : '');
            return '..';
          })
          .join(' '),
      );
    hooks.__fgbState = () => {
      const s = this.state;
      return { move: s.move, movesLeft: s.movesLeft, status: s.status, score: s.score, tools: { ...s.tools }, aggroMs: s.aggroMs, telegraphs: s.telegraphs.map((t) => ({ ...t })), busy: this.busy, overlay: !!this.overlay, tool: this.tool };
    };
  }

  update(_time: number, delta: number) {
    // Real time reaches the rules only as 'tick' actions, and only while the player could act.
    const s = this.state;
    if (s.status !== 'playing' || s.move === 0 || this.busy || this.overlay) return;
    this.tickAcc += Math.min(delta, 100);
    if (this.tickAcc < TICK_MS) return;
    const ms = this.tickAcc;
    this.tickAcc = 0;
    const out = resolve(s, { type: 'tick', ms });
    this.state = out.state;
    if (out.events.length) this.play(out.events);
    else this.refreshWeedHud();
  }

  // ---------- layout ----------

  private buildHud() {
    button(this, 66, 62, 104, 64, 'Pause', () => this.showPause(), 0x6a3a1c, 24);
    text(this, W / 2, 48, this.level.name, 34, '#f6eedc', { stroke: '#0d1f12', strokeThickness: 6 });
    const idx = ALL_LEVELS.indexOf(this.level);
    const sub = this.level.mode === 'endless' ? 'Endless Garden' : `Campaign · level ${idx + 1}`;
    text(this, W / 2, 88, sub, 20, '#cfe3b4');

    panel(this, W - 80, 66, 120, 100, 0x3a2416);
    text(this, W - 80, 36, this.level.mode === 'endless' ? 'Move' : 'Moves', 20, '#f2b928');
    const moves = text(this, W - 80, 78, '', 44, '#fffaf0');

    panel(this, W / 2, 196, W - 40, 150);
    const score = text(this, W - 130, 165, '', 26, '#f2b928', { align: 'center' });
    const objectives: Phaser.GameObjects.Text[] = [];
    const icons = this.objectiveIcons();
    icons.forEach((icon, i) => {
      const y = 150 + (icons.length === 1 ? 46 : i * 46 + 22);
      this.add.image(60, y, icon).setScale(0.42);
      objectives.push(text(this, 90, y, '', 23, '#f6eedc').setOrigin(0, 0.5));
    });
    const creepIcon = this.add.image(W - 220, 236, 'weed-creeping').setScale(0.32);
    const creep = text(this, W - 200, 236, '', 20, '#cfe3b4').setOrigin(0, 0.5);
    const aggroIcon = this.add.image(W - 120, 236, 'weed-aggressive').setScale(0.32);
    const aggro = text(this, W - 100, 236, '', 20, '#ffb3bf').setOrigin(0, 0.5);
    const debug = text(this, W / 2, 1266, '', 15, '#6f8a68');
    this.hud = { moves, score, objectives, creepIcon, creep, aggroIcon, aggro, debug };
  }

  private objectiveIcons(): string[] {
    if (this.level.mode === 'endless') return ['daisy-3'];
    return this.level.objectives.map((o) => {
      switch (o.kind) {
        case 'score':
          return 'sunflower-3';
        case 'blueprint':
          return `${this.level.blueprints.find((b) => b.id === o.blueprintId)!.cells[0].species}-3`;
        case 'clearWeeds':
          return 'weed-creeping';
        case 'nests':
          return 'nest';
        case 'protect':
          return `${this.level.plants?.find((p) => p.r === o.r && p.c === o.c)?.species ?? 'lily'}-3`;
      }
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
    this.weeds = [];
    this.infest = [];
    this.nests = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      this.plants.push(Array(BOARD_SIZE).fill(null));
      this.weeds.push(Array(BOARD_SIZE).fill(null));
      this.infest.push(Array(BOARD_SIZE).fill(null));
      this.nests.push(Array(BOARD_SIZE).fill(null));
      for (let c = 0; c < BOARD_SIZE; c++) {
        const { x, y } = this.tileCenter(r, c);
        const tile = this.state.tiles[r][c];
        const img = this.add.image(x, y, tile.blocked ? 'stone' : 'soil').setDisplaySize(TILE - 4, TILE - 4);
        if (!tile.blocked) {
          img.setInteractive({ useHandCursor: true });
          img.on('pointerover', () => this.showGhost(r, c));
          img.on('pointerout', () => this.hideGhost());
          img.on('pointerup', () => this.tapTile(r, c));
        }
        if (tile.slot) {
          this.add.image(x, y, `${tile.slot.species}-3`).setScale(0.62).setAlpha(0.3);
          slotGfx.lineStyle(3, PALETTE.gold, 0.9);
          slotGfx.strokeRoundedRect(x - TILE / 2 + 5, y - TILE / 2 + 5, TILE - 10, TILE - 10, 12);
        }
      }
    }
    this.protectGfx = this.add.graphics();
    this.weedLayer = this.add.container(0, 0);
    this.plantLayer = this.add.container(0, 0);
    this.overLayer = this.add.container(0, 0);
    this.telegraphGfx = this.add.graphics();
    this.forecastGfx = this.add.graphics();
    this.previewGfx = this.add.graphics();
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

  private buildToolbar() {
    const kinds: (ToolKind | 'compost')[] = ['pull', 'spray', 'burn', 'compost'];
    const labels = { pull: 'Pull', spray: 'Spray', burn: 'Burn', compost: 'Compost' };
    const w = 160;
    const h = 92;
    kinds.forEach((k, i) => {
      const x = W / 2 + (i - 1.5) * (w + 12);
      const box = this.add.container(x, TOOLBAR_Y);
      const g = this.add.graphics();
      const icon = this.add.image(-38, -2, `tool-${k}`).setScale(0.62);
      const label = text(this, 26, -16, labels[k], 21, '#fffaf0', { stroke: '#1d2a14', strokeThickness: 4 });
      const count = text(this, 26, 18, '', 26, '#f2b928', { stroke: '#1d2a14', strokeThickness: 4 });
      const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
      box.add([g, icon, label, count, zone]);
      const btn: ToolButton = {
        box,
        count,
        enabled: true,
        draw: (active, enabled) => {
          btn.enabled = enabled;
          g.clear();
          const fill = active ? 0x3d8a2c : k === 'compost' ? 0x6a3a1c : 0x2f4a26;
          g.fillStyle(Phaser.Display.Color.IntegerToColor(fill).darken(30).color, 1);
          g.fillRoundedRect(-w / 2, -h / 2 + 5, w, h, 18);
          g.fillStyle(fill, 1);
          g.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
          g.lineStyle(active ? 5 : 3, active ? 0xfff1a0 : PALETTE.gold, active ? 1 : 0.7);
          g.strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
          box.setAlpha(enabled || active ? 1 : 0.4);
        },
      };
      zone.on('pointerup', () => {
        if (!btn.enabled && this.tool !== k) return;
        this.tweens.add({ targets: box, scale: 0.95, duration: 60, yoyo: true });
        if (k === 'compost') this.compost();
        else this.pickTool(k);
      });
      this.toolButtons[k] = btn;
    });
  }

  private tileCenter(r: number, c: number) {
    return { x: BOARD_X + c * TILE + TILE / 2, y: BOARD_Y + r * TILE + TILE / 2 };
  }

  // ---------- state to screen ----------

  private refreshAll() {
    for (const t of this.temps) t.destroy();
    this.temps = [];
    this.syncPlants();
    this.syncWeeds();
    this.refreshHud();
    this.refreshConveyor();
    this.refreshForecast();
    this.refreshToolbar();
    this.refreshPreview();
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
          this.plantLayer.add(this.plants[r][c]!);
        } else {
          if (img.texture.key !== key) img.setTexture(key);
          img.setScale(0.8).setAlpha(1).setAngle(0).clearTint();
        }
      }
    }
  }

  /** Rebuilds weeds, infestations, nests, the guarded ring, spray cover and telegraphs. */
  private syncWeeds() {
    const s = this.state;
    this.tweens.killTweensOf(this.overLayer.list);
    this.weedLayer.removeAll(true);
    this.overLayer.removeAll(true);
    this.protectGfx.clear();
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const tile = s.tiles[r][c];
        const { x, y } = this.tileCenter(r, c);
        this.weeds[r][c] = null;
        this.infest[r][c] = null;
        this.nests[r][c] = null;
        if (isProtected(s, tile) && !tile.blocked) {
          this.protectGfx.fillStyle(0x7fc8ff, 0.22);
          this.protectGfx.fillRoundedRect(x - TILE / 2 + 2, y - TILE / 2 + 2, TILE - 4, TILE - 4, 12);
          this.protectGfx.lineStyle(2, 0xbfe3ff, 0.8);
          this.protectGfx.strokeRoundedRect(x - TILE / 2 + 4, y - TILE / 2 + 4, TILE - 8, TILE - 8, 12);
        }
        if (tile.weed) {
          const w = this.add.image(x, y, `weed-${tile.weed}`).setScale(WEED_SCALE);
          this.weedLayer.add(w);
          this.weeds[r][c] = w;
        }
        const p = tile.plant;
        if (p?.infested) {
          const o = this.add.image(x, y, `infest-${p.infested}`).setScale(WEED_SCALE);
          // Plantings left before the flower is choked.
          const left = CHOKE_LIMIT - (p.choke ?? 0);
          const badge = this.add.circle(x + 26, y - 26, 14, 0xc8283a).setStrokeStyle(3, 0xfff1e0);
          const num = text(this, x + 26, y - 27, String(left), 18, '#ffffff');
          this.overLayer.add([o, badge, num]);
          this.infest[r][c] = o;
        }
        if (p && p.id === s.guardedId) {
          const ring = this.add.circle(x, y, TILE / 2 - 4).setStrokeStyle(4, PALETTE.gold, 1);
          this.overLayer.add(ring);
          this.tweens.add({ targets: ring, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
        }
        if (tile.nest) {
          const box = this.add.container(x, y);
          box.add(this.add.image(0, -4, 'nest').setScale(WEED_SCALE));
          const max = Math.max(tile.nest.hp, 3);
          for (let i = 0; i < max; i++) {
            const px = (i - (max - 1) / 2) * 16;
            box.add(this.add.circle(px, 28, 6, i < tile.nest.hp ? 0xe0405a : 0x3a2a20).setStrokeStyle(2, 0xfff1e0));
          }
          const every = s.level.nestInterval ?? DEFAULT_NEST_INTERVAL;
          box.add(text(this, 26, -26, String(every - tile.nest.counter), 17, '#ffffff', { backgroundColor: '#3a2212', padding: { x: 5, y: 1 } }));
          this.overLayer.add(box);
          this.nests[r][c] = box;
        }
      }
    }
    this.drawTelegraphs();
  }

  private drawTelegraphs() {
    const g = this.telegraphGfx;
    g.clear();
    this.tweens.killTweensOf(g);
    g.setAlpha(1);
    if (this.state.status !== 'playing' || !this.state.telegraphs.length) return;
    for (const t of this.state.telegraphs) {
      const { x, y } = this.tileCenter(t.r, t.c);
      dashedRect(g, x - TILE / 2 + 6, y - TILE / 2 + 6, TILE - 12, TILE - 12, WEED_COLOR[t.type]);
      const hint = this.add.image(x - 22, y + 22, `weed-${t.type}`).setScale(0.22).setAlpha(0.85);
      this.overLayer.add(hint);
    }
    this.tweens.add({ targets: g, alpha: 0.45, duration: 650, yoyo: true, repeat: -1 });
  }

  private refreshHud() {
    const s = this.state;
    this.hud.moves.setText(s.movesLeft === null ? String(s.move) : String(s.movesLeft));
    this.hud.moves.setColor(s.movesLeft !== null && s.movesLeft <= 3 ? '#ff8a6a' : '#fffaf0');
    this.hud.score.setText(`Score\n${s.score.toLocaleString()}`);
    if (this.level.mode === 'endless') {
      this.hud.objectives[0].setText(`Patterns ${s.stats.patterns} · best combo ${s.stats.largestCombo}`);
    } else {
      this.level.objectives.forEach((o, i) => {
        const t = this.hud.objectives[i];
        switch (o.kind) {
          case 'score':
            t.setText(`Reach ${o.target.toLocaleString()} points`);
            break;
          case 'blueprint': {
            const bp = this.level.blueprints.find((b) => b.id === o.blueprintId)!;
            t.setText(`${bp.name}  ${Math.min(s.progress[bp.id], o.count)}/${o.count}`);
            break;
          }
          case 'clearWeeds': {
            const n = countWeeds(s) + countNests(s);
            t.setText(n ? `Clear every weed (${n} left)` : 'Every weed cleared');
            break;
          }
          case 'nests': {
            const n = countNests(s);
            t.setText(n ? `Destroy the Root Nest${n > 1 ? 's' : ''} (${n} left)` : 'Root Nest destroyed');
            break;
          }
          case 'protect': {
            const sp = this.level.plants?.find((p) => p.r === o.r && p.c === o.c)?.species ?? 'lily';
            t.setText(s.guardedLost ? `The ${SPECIES_LABEL[sp].toLowerCase()} was lost` : `Keep the ${SPECIES_LABEL[sp].toLowerCase()} safe`);
            break;
          }
        }
      });
    }
    this.hud.debug.setText(`seed ${s.seed} · move ${s.move}`);
    this.refreshWeedHud();
  }

  /** Creeping countdown (plantings) and aggressive countdown (seconds). Hidden when not in play. */
  private refreshWeedHud() {
    const s = this.state;
    const creeping = s.tiles.some((row) => row.some((t) => t.weed === 'creeping' || t.nest));
    this.hud.creepIcon.setVisible(creeping);
    this.hud.creep.setVisible(creeping).setText(`in ${movesUntilCreep(s)}`);
    const aggro = hasAggressive(s);
    this.hud.aggroIcon.setVisible(aggro);
    const secs = Math.max(0, Math.ceil(s.aggroMs / 1000));
    this.hud.aggro.setVisible(aggro).setText(`${secs}s`);
    this.hud.aggro.setColor(secs <= 5 && s.move > 0 ? '#ff6a7a' : '#ffb3bf');
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

  private refreshToolbar() {
    const s = this.state;
    const playing = s.status === 'playing';
    for (const k of ['pull', 'spray', 'burn'] as ToolKind[]) {
      const b = this.toolButtons[k]!;
      b.count.setText(String(s.tools[k]));
      b.draw(this.tool === k, playing && s.tools[k] > 0);
    }
    const comp = this.toolButtons.compost!;
    comp.count.setText(String(s.compostLeft));
    comp.draw(false, playing && s.compostLeft > 0 && !this.tool);
  }

  // ---------- input ----------

  private select(i: number) {
    // Choosing a seed never changes game state, so it stays responsive while a move animates.
    if (this.overlay || this.toolPanel) return;
    this.selected = i;
    this.refreshConveyor();
    this.tweens.add({ targets: this.slotImages[i], scale: 1.08, duration: 90, yoyo: true });
  }

  private showGhost(r: number, c: number) {
    if (this.busy || this.overlay || this.tool) return;
    const tile = this.state.tiles[r][c];
    if (!plantable(tile)) return;
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

  private tapTile(r: number, c: number) {
    if (this.overlay || this.state.status !== 'playing') return;
    if (this.tool) return this.toolTap(r, c);
    this.tryPlant(r, c);
  }

  private tryPlant(r: number, c: number) {
    if (this.busy) return;
    this.hideGhost();
    const { state, events } = resolve(this.state, { type: 'plant', slot: this.selected, r, c });
    if (events[0]?.type === 'rejected') {
      this.toast(events[0].reason);
      const img = this.plants[r][c] ?? this.weeds[r][c];
      if (img) this.tweens.add({ targets: img, x: img.x + 6, duration: 50, yoyo: true, repeat: 2 });
      return;
    }
    this.state = state;
    this.play(events);
  }

  private compost() {
    if (this.busy || this.overlay || this.tool) return;
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

  private pickTool(kind: ToolKind) {
    if (this.overlay || this.state.status !== 'playing') return;
    if (this.tool === kind) return this.cancelTool();
    if (this.state.tools[kind] <= 0) return this.toast(`No ${TOOL_NAME[kind]} left.`);
    this.hideGhost();
    this.tool = kind;
    this.target = null;
    this.axis = 'row';
    this.showToolPanel();
    this.refreshToolbar();
    this.refreshPreview();
  }

  private cancelTool() {
    this.tool = null;
    this.target = null;
    this.toolPanel?.destroy();
    this.toolPanel = null;
    this.refreshToolbar();
    this.refreshPreview();
  }

  private toolAction() {
    return { type: 'tool' as const, tool: this.tool!, r: this.target!.r, c: this.target!.c, axis: this.axis };
  }

  private toolTap(r: number, c: number) {
    if (this.busy) return;
    if (this.target && this.target.r === r && this.target.c === c) return this.confirmTool();
    // Dry run: resolve() is pure, so it doubles as the validity check for the preview.
    const trial = resolve(this.state, { type: 'tool', tool: this.tool!, r, c, axis: this.axis });
    if (trial.events[0]?.type === 'rejected') return this.toast(trial.events[0].reason);
    this.target = { r, c };
    this.showToolPanel();
    this.refreshPreview();
  }

  private confirmTool() {
    if (!this.tool || !this.target || this.busy) return;
    const { state, events } = resolve(this.state, this.toolAction());
    if (events[0]?.type === 'rejected') return this.toast(events[0].reason);
    const action = this.toolAction();
    this.state = state;
    this.cancelTool();
    // Flames run along the whole burned line, not only over the plants it destroys.
    if (action.tool === 'burn') this.animateFlames(toolArea('burn', action.r, action.c, action.axis));
    this.play(events);
  }

  /** What the previewed tool use would do, for the panel text and the burn warning. */
  private previewSummary() {
    const s = this.state;
    const cells = toolArea(this.tool!, this.target!.r, this.target!.c, this.axis);
    let weeds = 0;
    let saved = 0;
    let nests = 0;
    const lost: Species[] = [];
    let guarded = false;
    for (const { r, c } of cells) {
      const t = s.tiles[r][c];
      if (t.weed) weeds++;
      if (t.nest) nests++;
      if (t.plant) {
        if (this.tool === 'burn') {
          lost.push(t.plant.species);
          if (t.plant.id === s.guardedId) guarded = true;
        } else if (t.plant.infested) saved++;
      }
    }
    return { weeds, saved, nests, lost, guarded };
  }

  private showToolPanel() {
    this.toolPanel?.destroy();
    const kind = this.tool!;
    const c = this.add.container(0, 0);
    const blocker = this.add.rectangle(W / 2, CONVEYOR_Y, W - 40, 176, 0x000000, 0.001).setInteractive();
    c.add(blocker);
    c.add(panel(this, W / 2, CONVEYOR_Y, W - 40, 176, 0x173a24, 0.98));
    c.add(this.add.image(70, CONVEYOR_Y - 46, `tool-${kind}`).setScale(0.5));
    c.add(text(this, 110, CONVEYOR_Y - 48, TOOL_NAME[kind], 28, '#f2b928').setOrigin(0, 0.5));
    let line = TOOL_HELP[kind];
    let warn = '';
    if (this.target) {
      const p = this.previewSummary();
      const bits: string[] = [];
      if (p.weeds) bits.push(`clears ${p.weeds} weed${p.weeds > 1 ? 's' : ''}`);
      if (p.saved) bits.push(`saves ${p.saved} flower${p.saved > 1 ? 's' : ''}`);
      if (p.nests) bits.push(`hits ${p.nests} Root Nest${p.nests > 1 ? 's' : ''}`);
      if (kind === 'spray') bits.push('blocks weeds for 2 plantings');
      line = bits.length ? cap(bits.join(', ')) + '.' : kind === 'burn' ? `Burns this ${this.axis === 'row' ? 'row' : 'column'}.` : 'Nothing to clear here.';
      if (p.lost.length) {
        const names = [...new Set(p.lost.map((x) => SPECIES_LABEL[x]))].join(', ');
        warn = `Destroys ${p.lost.length} plant${p.lost.length > 1 ? 's' : ''} (${names}).`;
        if (p.guarded) warn += ' Including the one you must protect!';
      }
      if (kind !== 'burn') line += ' Tap it again to confirm.';
    }
    c.add(text(this, 40, CONVEYOR_Y - 12, line, 21, '#f6eedc', { wordWrap: { width: W - 120 } }).setOrigin(0, 0.5));
    if (warn) c.add(text(this, 40, CONVEYOR_Y + 18, warn, 20, '#ff8a6a', { wordWrap: { width: W - 120 } }).setOrigin(0, 0.5));
    const by = CONVEYOR_Y + 62;
    if (kind === 'burn') {
      c.add(button(this, 150, by, 220, 54, this.axis === 'row' ? 'Row ↔' : 'Column ↕', () => this.toggleAxis(), 0x6a3a1c, 22));
    }
    const use = button(this, W - 290, by, 160, 54, kind === 'burn' ? 'Burn' : 'Use', () => this.confirmTool(), kind === 'burn' ? 0xc8283a : 0x3d8a2c, 24);
    use.setEnabled(!!this.target);
    c.add(use);
    c.add(button(this, W - 110, by, 160, 54, 'Cancel', () => this.cancelTool(), 0x3a2416, 22));
    this.toolPanel = c;
  }

  private toggleAxis() {
    this.axis = this.axis === 'row' ? 'col' : 'row';
    if (this.target) {
      const trial = resolve(this.state, this.toolAction());
      if (trial.events[0]?.type === 'rejected') this.target = null;
    }
    this.showToolPanel();
    this.refreshPreview();
  }

  private refreshPreview() {
    const g = this.previewGfx;
    g.clear();
    if (!this.tool || !this.target) return;
    const s = this.state;
    for (const { r, c } of toolArea(this.tool, this.target.r, this.target.c, this.axis)) {
      const t = s.tiles[r][c];
      if (t.blocked) continue;
      const { x, y } = this.tileCenter(r, c);
      const bad = this.tool === 'burn' && !!t.plant;
      g.fillStyle(bad ? 0xff3a2a : this.tool === 'spray' ? 0x7fc8ff : 0xfff1a0, bad ? 0.4 : 0.28);
      g.fillRoundedRect(x - TILE / 2 + 3, y - TILE / 2 + 3, TILE - 6, TILE - 6, 12);
      g.lineStyle(3, bad ? 0xff3a2a : 0xfff1a0, 1);
      g.strokeRoundedRect(x - TILE / 2 + 3, y - TILE / 2 + 3, TILE - 6, TILE - 6, 12);
    }
  }

  private restart() {
    this.scene.restart({ level: this.level });
  }

  // ---------- animation from engine events ----------

  private play(events: GameEvent[]) {
    this.busy = true;
    this.hideGhost();
    const burstCount = events.filter((e) => e.type === 'burst').length;
    const BURST_AT = 320;
    const weedsAt = burstCount ? BURST_AT + burstCount * 220 + 260 : events.some((e) => e.type === 'planted') ? 280 : 0;
    let phase: 'growth' | 'bursts' | 'weeds' = 'growth';
    let burstIndex = -1;
    let ended = false;
    let weedEvents = false;

    for (const e of events) {
      if (e.type === 'burst') {
        phase = 'bursts';
        burstIndex++;
      }
      if (e.type === 'scored') phase = 'weeds';
      if (phase === 'growth' && (e.type === 'choked' || e.type === 'spread' || e.type === 'infested')) phase = 'weeds';
      const at = phase === 'growth' ? 0 : phase === 'bursts' ? BURST_AT + burstIndex * 220 : weedsAt;
      const later = (fn: () => void, extra = 0) => (at + extra > 0 ? this.time.delayedCall(at + extra, fn) : fn());

      switch (e.type) {
        case 'grew':
          for (const p of e.plants) {
            const img = this.plants[p.r][p.c];
            if (!img) continue;
            img.setTexture(`${this.state.tiles[p.r][p.c].plant?.species ?? img.texture.key.split('-')[0]}-${p.stage}`);
            this.tweens.add({ targets: img, scale: { from: 0.95, to: 0.8 }, duration: 260, ease: 'Back.Out' });
          }
          break;
        case 'planted': {
          const { x, y } = this.tileCenter(e.r, e.c);
          const img = this.add.image(x, y, `${e.species}-1`).setScale(0.2);
          this.plantLayer.add(img);
          this.plants[e.r][e.c] = img;
          this.tweens.add({ targets: img, scale: 0.8, duration: 220, ease: 'Back.Out' });
          break;
        }
        case 'conveyor':
          this.time.delayedCall(120, () => this.slideIn(e.slot));
          break;
        case 'burst':
          later(() => this.bloomBurst(e.burst.cells, e.burst.species, PATTERN_NAMES[e.burst.kind], e.burst.blueprintId));
          break;
        case 'scored':
          this.time.delayedCall(BURST_AT + 150, () => this.scorePopup(e.points, e.combo, e.multi, burstCount));
          break;
        case 'cleared':
          later(() => this.animateCleared(e.cells, e.cured), e.by === 'burst' ? 180 : 0);
          break;
        case 'destroyed':
          later(() => this.animateBurn(e.cells));
          break;
        case 'nestHit':
          later(() => this.animateNestHit(e.r, e.c, e.hp), 200);
          break;
        case 'protected':
          later(() => this.animateSpray(e.cells));
          break;
        case 'spread':
          weedEvents = true;
          later(() => this.animateSpread(e.r, e.c, e.weed, e.source === 'endless'));
          break;
        case 'infested':
          weedEvents = true;
          later(() => this.animateInfest(e.r, e.c, e.weed));
          break;
        case 'choked':
          weedEvents = true;
          later(() => this.animateChoke(e.r, e.c));
          break;
        case 'toolEarned':
          this.time.delayedCall(BURST_AT + 500, () => this.toast(`Earned ${TOOL_NAME[e.tool]}!`, '#d8ffb0'));
          break;
        case 'stuck':
          this.time.delayedCall(weedsAt + 300, () => this.promptStuck());
          break;
        case 'ended':
          ended = true;
          break;
        default:
          break;
      }
    }

    const total = Math.max(burstCount ? BURST_AT + burstCount * 220 + 520 : 300, weedEvents ? weedsAt + 520 : 0, 260);
    this.time.delayedCall(total, () => {
      this.busy = false;
      this.refreshAll();
      if (ended) this.time.delayedCall(350, () => this.showResult());
    });
    this.refreshHud();
    this.refreshToolbar();
  }

  private slideIn(slot: number) {
    const img = this.slotImages[slot];
    img.setTexture(`${this.state.conveyor[slot]}-3`);
    this.slotLabels[slot].setText(SPECIES_LABEL[this.state.conveyor[slot]]);
    img.setX(SLOT_X[slot] + 90).setAlpha(0);
    this.tweens.add({ targets: img, x: SLOT_X[slot], alpha: 1, duration: 250, ease: 'Cubic.Out' });
  }

  private temp<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.temps.push(obj);
    return obj;
  }

  private animateSpread(r: number, c: number, weed: WeedType, fresh: boolean) {
    const { x, y } = this.tileCenter(r, c);
    const img = this.temp(this.add.image(x, y, `weed-${weed}`).setScale(0));
    this.weedLayer.add(img);
    this.tweens.add({ targets: img, scale: WEED_SCALE, angle: { from: -25, to: 0 }, duration: 380, ease: 'Back.Out' });
    if (fresh) {
      const ring = this.temp(this.add.circle(x, y, 12).setStrokeStyle(5, WEED_COLOR[weed], 1));
      this.tweens.add({ targets: ring, radius: 50, alpha: 0, duration: 500 });
    }
  }

  private animateInfest(r: number, c: number, weed: WeedType) {
    const { x, y } = this.tileCenter(r, c);
    const img = this.temp(this.add.image(x, y, `infest-${weed}`).setScale(WEED_SCALE).setAlpha(0));
    this.overLayer.add(img);
    this.tweens.add({ targets: img, alpha: 1, duration: 300 });
    const plant = this.plants[r][c];
    if (plant) this.tweens.add({ targets: plant, x: x + 4, duration: 60, yoyo: true, repeat: 3 });
  }

  private animateChoke(r: number, c: number) {
    const img = this.plants[r][c];
    this.plants[r][c] = null;
    const { x, y } = this.tileCenter(r, c);
    if (img) {
      img.setTint(0x6a5a40);
      this.tweens.add({ targets: img, scale: 0.3, alpha: 0, angle: -30, duration: 380, onComplete: () => img.destroy() });
    }
    this.infest[r][c]?.setVisible(false);
    const label = this.temp(text(this, x, y - 30, 'Choked!', 22, '#ff8a6a', { stroke: '#2a1a10', strokeThickness: 5 }));
    this.tweens.add({ targets: label, y: y - 60, alpha: 0, duration: 800 });
  }

  private animateCleared(cells: Cell[], cured: Cell[]) {
    for (const { r, c } of cells) {
      const w = this.weeds[r][c];
      const { x, y } = this.tileCenter(r, c);
      const color = this.state.tiles[r][c].weed ? 0x8fd13f : w?.texture.key === 'weed-aggressive' ? 0xe0405a : 0x8fd13f;
      w?.setVisible(false);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + r;
        const leaf = this.add.image(x, y, 'leaf').setScale(0.5).setTint(color).setRotation(a);
        this.tweens.add({ targets: leaf, x: x + Math.cos(a) * 46, y: y + Math.sin(a) * 46 - 20, alpha: 0, angle: 200, duration: 520, onComplete: () => leaf.destroy() });
      }
    }
    for (const { r, c } of cured) {
      this.infest[r][c]?.setVisible(false);
      const { x, y } = this.tileCenter(r, c);
      const ring = this.add.circle(x, y, 10).setStrokeStyle(5, 0x7fe07a, 1);
      this.tweens.add({ targets: ring, radius: 44, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
      const label = text(this, x, y - 30, 'Saved!', 22, '#c8ffb0', { stroke: '#2a1a10', strokeThickness: 5 });
      this.tweens.add({ targets: label, y: y - 60, alpha: 0, duration: 800, onComplete: () => label.destroy() });
    }
  }

  private animateBurn(cells: Cell[]) {
    for (const { r, c } of cells) {
      const img = this.plants[r][c];
      this.plants[r][c] = null;
      if (img) {
        img.setTint(0x2a1a10);
        this.tweens.add({ targets: img, alpha: 0, scale: 0.5, duration: 420, onComplete: () => img.destroy() });
      }
    }
  }

  private animateFlames(cells: Cell[]) {
    cells.forEach(({ r, c }, i) => {
      if (this.state.tiles[r][c].blocked) return;
      const { x, y } = this.tileCenter(r, c);
      const f = this.add.image(x, y + 10, 'tool-burn').setScale(0.2).setAlpha(0.95);
      this.tweens.add({ targets: f, scale: 0.75, y: y - 10, alpha: 0, duration: 560, delay: i * 35, onComplete: () => f.destroy() });
    });
    this.cameras.main.shake(140, 0.004);
  }

  private animateNestHit(r: number, c: number, hp: number) {
    const box = this.nests[r][c];
    if (!box) return;
    if (hp <= 0) {
      this.tweens.add({ targets: box, scale: 0.2, alpha: 0, angle: 40, duration: 450 });
      const { x, y } = this.tileCenter(r, c);
      const label = text(this, x, y - 30, 'Nest destroyed!', 22, '#fff1a0', { stroke: '#2a1a10', strokeThickness: 5 });
      this.tweens.add({ targets: label, y: y - 70, alpha: 0, duration: 1000, onComplete: () => label.destroy() });
    } else {
      this.tweens.add({ targets: box, x: box.x + 6, duration: 50, yoyo: true, repeat: 3 });
    }
  }

  private animateSpray(cells: Cell[]) {
    for (const { r, c } of cells) {
      if (this.state.tiles[r][c].blocked) continue;
      const { x, y } = this.tileCenter(r, c);
      const mist = this.add.rectangle(x, y, TILE - 6, TILE - 6, 0xbfe3ff, 0.6);
      this.tweens.add({ targets: mist, alpha: 0, scale: 1.15, duration: 600, onComplete: () => mist.destroy() });
    }
  }

  private bloomBurst(cells: Cell[], species: Species[], name: string, blueprintId?: string) {
    cells.forEach((cell, i) => {
      const { x, y } = this.tileCenter(cell.r, cell.c);
      const img = this.plants[cell.r][cell.c];
      this.plants[cell.r][cell.c] = null;
      this.infest[cell.r][cell.c]?.setVisible(false);
      const color = SPECIES_COLOR[species[i]];
      if (img) {
        this.plantLayer.bringToTop(img);
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

  private promptStuck() {
    this.toast('No empty soil left. Use a tool to clear some space.', '#fff1a0', 2200);
    for (const k of ['pull', 'spray', 'burn'] as ToolKind[]) {
      const b = this.toolButtons[k]!;
      if (this.state.tools[k] > 0) this.tweens.add({ targets: b.box, scale: 1.08, duration: 220, yoyo: true, repeat: 3 });
    }
  }

  private toast(msg: string, color = '#ffd2c4', hold = 900) {
    const t = text(this, W / 2, CONVEYOR_Y - 150, msg, 24, color, { backgroundColor: '#2a1a10cc', padding: { x: 16, y: 8 }, align: 'center', wordWrap: { width: W - 80 } });
    this.tweens.add({ targets: t, alpha: 0, delay: hold, duration: 400, onComplete: () => t.destroy() });
  }

  // ---------- overlays ----------

  private makeOverlay(height: number, opaque = false) {
    const c = this.add.container(0, 0);
    const shade = this.add.rectangle(W / 2, 640, W, 1280, opaque ? PALETTE.forest : 0x000000, opaque ? 1 : 0.6).setInteractive();
    c.add(shade);
    c.add(panel(this, W / 2, 640, 600, height, 0x173a24, 0.98));
    this.overlay = c;
    return c;
  }

  private closeOverlay() {
    this.overlay?.destroy();
    this.overlay = null;
  }

  /** Pause hides the board, so the timer cannot be beaten by pausing to plan (GDD C5). */
  private showPause() {
    if (this.overlay) return;
    if (this.tool) this.cancelTool();
    const c = this.makeOverlay(560, true);
    c.add(text(this, W / 2, 430, 'Paused', 52, '#f2b928', { stroke: '#0d1f12', strokeThickness: 6 }));
    c.add(text(this, W / 2, 500, this.level.name, 28, '#f6eedc'));
    const timed = hasAggressive(this.state) ? 'The weed timer is stopped while paused.' : '';
    if (timed) c.add(text(this, W / 2, 545, timed, 20, '#cfe3b4'));
    c.add(button(this, W / 2, 630, 360, 84, 'Resume', () => this.closeOverlay()));
    c.add(button(this, W / 2, 730, 360, 76, 'Restart', () => this.restart(), 0x6a3a1c, 28));
    c.add(button(this, W / 2, 825, 360, 76, 'Menu', () => this.scene.start('menu'), 0x6a3a1c, 28));
  }

  private showIntro() {
    const lvl = this.level;
    const c = this.makeOverlay(580);
    c.add(text(this, W / 2, 400, lvl.name, 44, '#f2b928', { stroke: '#0d1f12', strokeThickness: 6 }));
    c.add(text(this, W / 2, 478, lvl.intro, 27, '#f6eedc', { align: 'center', wordWrap: { width: 520 } }));
    if (lvl.tip) c.add(text(this, W / 2, 590, lvl.tip, 21, '#cfe3b4', { align: 'center', wordWrap: { width: 530 }, lineSpacing: 5 }));

    const legend = this.legend();
    if (legend.length) {
      legend.forEach((item, i) => {
        const x = W / 2 + (i - (legend.length - 1) / 2) * 180;
        c.add(this.add.image(x, 712, item.icon).setScale(0.6));
        c.add(text(this, x, 772, item.label, 18, '#f6eedc', { align: 'center', wordWrap: { width: 170 } }));
      });
    } else {
      const sp = lvl.blueprints[0]?.cells[0].species ?? 'daisy';
      ['Seed', 'Sprout', 'Bloom'].forEach((s, i) => {
        const x = W / 2 - 150 + i * 150;
        c.add(this.add.image(x, 712, `${sp}-${i + 1}`).setScale(0.8));
        c.add(text(this, x, 767, s, 20, '#f6eedc'));
        if (i < 2) c.add(text(this, x + 75, 712, '→', 36, '#f2b928'));
      });
    }
    c.add(button(this, W / 2, 870, 280, 84, 'Start', () => this.closeOverlay()));
  }

  /** Icons for the weeds and tools a level introduces, shown on its intro card. */
  private legend(): { icon: string; label: string }[] {
    const lvl = this.level;
    const out: { icon: string; label: string }[] = [];
    const types = new Set((lvl.weeds ?? []).map((w) => w.type));
    if (types.has('creeping')) out.push({ icon: 'weed-creeping', label: `Vine: spreads every ${lvl.creepInterval ?? 3} plantings` });
    if (types.has('aggressive')) out.push({ icon: 'weed-aggressive', label: `Red weed: spreads every ${(lvl.aggressiveMs ?? 15000) / 1000}s` });
    if (lvl.nests?.length) out.push({ icon: 'nest', label: `Root Nest: a weed every ${lvl.nestInterval ?? DEFAULT_NEST_INTERVAL} plantings` });
    for (const k of ['pull', 'spray', 'burn'] as ToolKind[]) {
      const n = lvl.tools?.[k] ?? 0;
      if (n && out.length < 3) out.push({ icon: `tool-${k}`, label: `${TOOL_NAME[k]} ×${n}` });
    }
    return out.slice(0, 3);
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

    const c = this.makeOverlay(720);
    const title = endless ? 'Run complete' : won ? 'Garden complete!' : 'Level failed';
    c.add(text(this, W / 2, 340, title, 48, won || endless ? '#f2b928' : '#ff8a6a', { stroke: '#0d1f12', strokeThickness: 6 }));
    c.add(text(this, W / 2, 405, s.endReason ?? '', 24, '#cfe3b4', { align: 'center', wordWrap: { width: 520 } }));
    if (won) for (let i = 0; i < 3; i++) c.add(star(this, W / 2 - 90 + i * 90, 485, 36, i < s.stars));
    const mins = Math.floor(s.stats.playMs / 60000);
    const secs = Math.floor((s.stats.playMs % 60000) / 1000);
    const lines = endless
      ? [
          `Score ${s.score.toLocaleString()}${best ? ' (new best!)' : ''}`,
          `Patterns ${s.stats.patterns} · flowers grown ${s.stats.flowersGrown}`,
          `Weeds removed ${s.stats.weedsRemoved} · largest combo ${s.stats.largestCombo}`,
          `Survived ${s.move} moves · ${mins}:${String(secs).padStart(2, '0')} of play`,
        ]
      : [
          `Score ${s.score.toLocaleString()}`,
          won ? `Coins this level: ${(50 + s.coins).toLocaleString()}` : 'A life would be used here (lives arrive in Prototype C).',
          s.bloomed.length ? `Bloomed: ${s.bloomed.map((b) => SPECIES_LABEL[b]).join(', ')}` : 'No patterns bloomed.',
          ...(s.hadWeeds ? [`Weeds removed: ${s.stats.weedsRemoved}`] : []),
        ];
    lines.forEach((l, i) => c.add(text(this, W / 2, 570 + i * 44, l, 25, '#f6eedc', { align: 'center', wordWrap: { width: 540 } })));
    if (won) c.add(text(this, W / 2, 750, 'Plant card choice comes in Prototype C.', 20, '#9fbf92'));

    const idx = ALL_LEVELS.indexOf(this.level);
    const next = won && idx >= 0 && idx < ALL_LEVELS.length - 1 ? ALL_LEVELS[idx + 1] : null;
    if (next) {
      c.add(button(this, W / 2, 840, 360, 80, 'Next level', () => this.scene.start('game', { level: next })));
      c.add(button(this, W / 2 - 100, 935, 180, 70, 'Replay', () => this.restart(), 0x6a3a1c, 24));
      c.add(button(this, W / 2 + 100, 935, 180, 70, 'Menu', () => this.scene.start('menu'), 0x6a3a1c, 24));
    } else {
      c.add(button(this, W / 2, 840, 360, 80, won || endless ? 'Play again' : 'Try again', () => this.restart()));
      c.add(button(this, W / 2, 935, 360, 70, 'Menu', () => this.scene.start('menu'), 0x6a3a1c, 24));
    }
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Dashed rounded-corner outline, used for the "weeds spread here next" preview. */
function dashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number) {
  g.lineStyle(4, color, 1);
  const dash = 10;
  const gap = 7;
  const side = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(d + dash, len);
      g.lineBetween(x1 + ((x2 - x1) * d) / len, y1 + ((y2 - y1) * d) / len, x1 + ((x2 - x1) * e) / len, y1 + ((y2 - y1) * e) / len);
    }
  };
  side(x, y, x + w, y);
  side(x + w, y, x + w, y + h);
  side(x + w, y + h, x, y + h);
  side(x, y + h, x, y);
}
