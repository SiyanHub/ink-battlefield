import { test } from "node:test";
import assert from "node:assert/strict";
import { PaintField } from "../src/core/paint";
import type { PaintSurface } from "../src/shared/contracts";
const floor: PaintSurface = {
  id: "floor",
  center: { x: 0, y: 0, z: 0 },
  u: { x: 1, y: 0, z: 0 },
  v: { x: 0, y: 0, z: -1 },
  normal: { x: 0, y: 1, z: 0 },
  width: 2,
  height: 2,
  cellSize: 1,
  scoring: true,
  boxId: "ground",
};
test("painting wall never scores; overpainting transfers ownership without erasing distant colors", () => {
  const p = new PaintField([floor, { ...floor, id: "wall", scoring: false }]);
  p.stamp("wall", { x: 0, y: 0, z: 0 }, 4, "red", 0xff0000);
  assert.equal(p.coverage().red ?? 0, 0);
  p.stamp("floor", { x: -0.5, y: 0, z: 0.5 }, 0.3, "red", 0xff0000);
  p.stamp("floor", { x: 0.5, y: 0, z: -0.5 }, 0.3, "blue", 0x0000ff);
  assert.deepEqual(p.coverage(), { red: 25, blue: 25 });
  p.stamp("floor", { x: -0.5, y: 0, z: 0.5 }, 0.3, "blue", 0x00ff00);
  assert.equal(p.coverage().blue, 50);
  const saved = p.snapshot();
  const restored = new PaintField([
    floor,
    { ...floor, id: "wall", scoring: false },
  ]);
  restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
  for (let i = 0; i < 10000; i++)
    p.stamp("floor", { x: 0, y: 0, z: 0 }, 5, "blue", i);
  assert.equal(
    p.snapshot().surfaces.find((s) => s.id === "floor")!.cells.length,
    4,
  );
});
