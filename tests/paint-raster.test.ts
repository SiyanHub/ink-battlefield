import { test } from "node:test";
import assert from "node:assert/strict";
import { PaintRaster } from "../src/client/paint-raster";
import type {
  PaintSurface,
  PaintSurfaceSnapshot,
} from "../src/shared/contracts";

const surface: PaintSurface = {
  id: "floor",
  center: { x: 0, y: 0, z: 0 },
  u: { x: 1, y: 0, z: 0 },
  v: { x: 0, y: 0, z: 1 },
  normal: { x: 0, y: 1, z: 0 },
  width: 128,
  height: 128,
  cellSize: 1,
  scoring: true,
  boxId: "floor",
};

function recordingContext() {
  const clears: Array<[number, number, number, number]> = [];
  const fills: string[] = [];
  const makeContext = () => ({
    fillStyle: "",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    drawImage() {},
    clearRect(x: number, y: number, w: number, h: number) {
      clears.push([x, y, w, h]);
    },
    fill() {
      fills.push(this.fillStyle);
    },
  });
  const ctx = makeContext();
  Object.assign(ctx, {
    getContextAttributes: () => ({ willReadFrequently: false }),
    canvas: {
      ownerDocument: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => makeContext(),
        }),
      },
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, clears, fills };
}

test("overpainting redraws the old spot and its overlapping neighbor within a local region", () => {
  const { ctx, clears, fills } = recordingContext();
  const raster = new PaintRaster(surface, ctx, 512, 512);
  const first: PaintSurfaceSnapshot = {
    id: "floor",
    revision: 1,
    cells: [
      [65 * 128 + 65, 0xff0000, "red"],
      [65 * 128 + 66, 0x00ff00, "green"],
    ],
  };
  raster.apply(first);
  clears.length = 0;
  fills.length = 0;
  raster.apply({
    id: "floor",
    revision: 2,
    cells: [[65 * 128 + 65, 0x0000ff, "blue"], first.cells[1]],
  });
  assert.ok(clears.length > 0);
  assert.ok(clears.every(([, , w, h]) => w < 512 && h < 512));
  assert.ok(fills.includes("#0000ff"));
  assert.ok(fills.includes("#00ff00"));
  assert.ok(!fills.includes("#ff0000"));
});

test("one changed cell on a full canvas redraws a bounded number of spots", () => {
  const { ctx, clears, fills } = recordingContext();
  const raster = new PaintRaster(surface, ctx, 512, 512);
  const cells: PaintSurfaceSnapshot["cells"] = Array.from(
    { length: 128 * 128 },
    (_, index) => [index, 0xff0000, "red"],
  );
  raster.apply({ id: "floor", revision: 1, cells });
  clears.length = 0;
  fills.length = 0;
  cells[65 * 128 + 65] = [65 * 128 + 65, 0x0000ff, "blue"];
  raster.apply({ id: "floor", revision: 2, cells });
  assert.ok(clears.length > 0);
  assert.ok(clears.every(([, , w, h]) => w < 512 && h < 512));
  assert.ok(fills.length < 2000, `redrew ${fills.length} marks`);
});
