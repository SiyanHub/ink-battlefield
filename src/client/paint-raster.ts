import type { PaintSurface, PaintSurfaceSnapshot } from "../shared/contracts";

const TILE = 64;
// Polygon reaches .8 cell; satellites add at least one pixel of radius.

/** Renders authoritative paint snapshots into one reusable canvas per surface. */
export class PaintRaster {
  private colors = new Map<number, number>();
  private bins = new Map<number, Set<number>>();
  private readonly cols: number;
  private readonly tilesX: number;
  private readonly sx: number;
  private readonly sy: number;
  private readonly cellX: number;
  private readonly cellY: number;
  private readonly scratch: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  };

  constructor(
    private readonly surface: PaintSurface,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.cols = Math.ceil(surface.width / surface.cellSize);
    this.tilesX = Math.ceil(width / TILE);
    this.sx = width / surface.width;
    this.sy = height / surface.height;
    this.cellX = surface.cellSize * this.sx;
    this.cellY = surface.cellSize * this.sy;
    const scratch = ctx.canvas.ownerDocument.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const scratchCtx = scratch.getContext("2d", {
      willReadFrequently:
        ctx.getContextAttributes?.().willReadFrequently ?? false,
    });
    if (!scratchCtx) throw new Error("Paint raster requires a 2D work canvas");
    this.scratch = { canvas: scratch, ctx: scratchCtx };
  }

  clear(): boolean {
    if (!this.colors.size) return false;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.colors.clear();
    this.bins.clear();
    return true;
  }

  apply(snapshot: PaintSurfaceSnapshot): boolean {
    const next = new Map<number, number>();
    const order = new Map<number, number>();
    snapshot.cells.forEach(([index, color], position) => {
      next.set(index, color);
      order.set(index, position);
    });

    if (!this.colors.size) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      for (const [index, color] of next) {
        this.addToBins(index);
        this.draw(index, color);
      }
      this.colors = next;
      return true;
    }

    const dirty = new Set<number>();
    for (const [index, color] of this.colors) {
      if (next.get(index) !== color) {
        this.markTiles(index, dirty);
        if (!next.has(index)) this.removeFromBins(index);
      }
    }
    for (const [index, color] of next) {
      if (this.colors.get(index) !== color) {
        this.markTiles(index, dirty);
        if (!this.colors.has(index)) this.addToBins(index);
      }
    }
    this.colors = next;
    for (const tile of dirty) {
      const x = (tile % this.tilesX) * TILE;
      const y = Math.floor(tile / this.tilesX) * TILE;
      const w = Math.min(TILE, this.width - x);
      const h = Math.min(TILE, this.height - y);
      const indexes = [...(this.bins.get(tile) ?? [])];
      indexes.sort((a, b) => order.get(a)! - order.get(b)!);
      const { canvas, ctx } = this.scratch;
      ctx.clearRect(x, y, w, h);
      for (const index of indexes) {
        const color = next.get(index);
        if (color !== undefined) this.draw(index, color, ctx);
      }
      this.ctx.clearRect(x, y, w, h);
      this.ctx.save();
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(canvas, x, y, w, h, x, y, w, h);
      this.ctx.restore();
    }
    return dirty.size > 0;
  }

  private forSpotTiles(index: number, visit: (tile: number) => void): void {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    const x = (col + 0.5) * this.cellX;
    const y = this.height - (row + 0.5) * this.cellY;
    const radius = Math.max(1, this.cellX * 0.08);
    const reachX = this.cellX * 0.8 + radius;
    const reachY = this.cellY * 0.8 + radius;
    const left = Math.max(0, Math.floor((x - reachX) / TILE));
    const right = Math.min(this.tilesX - 1, Math.floor((x + reachX) / TILE));
    const top = Math.max(0, Math.floor((y - reachY) / TILE));
    const bottom = Math.min(
      Math.ceil(this.height / TILE) - 1,
      Math.floor((y + reachY) / TILE),
    );
    for (let ty = top; ty <= bottom; ty++)
      for (let tx = left; tx <= right; tx++) visit(ty * this.tilesX + tx);
  }

  private markTiles(index: number, dirty: Set<number>): void {
    this.forSpotTiles(index, (tile) => dirty.add(tile));
  }

  private addToBins(index: number): void {
    this.forSpotTiles(index, (tile) => {
      let bin = this.bins.get(tile);
      if (!bin) this.bins.set(tile, (bin = new Set()));
      bin.add(index);
    });
  }

  private removeFromBins(index: number): void {
    this.forSpotTiles(index, (tile) => {
      const bin = this.bins.get(tile);
      bin?.delete(index);
      if (bin?.size === 0) this.bins.delete(tile);
    });
  }

  private draw(index: number, color: number, ctx = this.ctx): void {
    const x = ((index % this.cols) + 0.5) * this.cellX;
    const y = this.height - (Math.floor(index / this.cols) + 0.5) * this.cellY;
    ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
    ctx.beginPath();
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * Math.PI * 2;
      const r = 0.67 + Math.sin(index * 7 + j * 13) * 0.13;
      const xx = x + Math.cos(a) * this.cellX * r;
      const yy = y + Math.sin(a) * this.cellY * r;
      j ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    }
    ctx.closePath();
    ctx.fill();
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(
        x + Math.sin(index + k * 4) * this.cellX * 0.8,
        y + Math.cos(index * 2 + k) * this.cellY * 0.8,
        Math.max(1, this.cellX * 0.08),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
