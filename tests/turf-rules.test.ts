import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { PaintField } from "../src/core/paint";
import { maps, weapons } from "../src/content";
import { neutralInput, type MapDefinition, type PaintSurface } from "../src/shared/contracts";
import { teamInk } from "../src/shared/ink";

const floor: PaintSurface = {
  id: "ground:top", boxId: "ground", center: { x: 0, y: 0, z: 0 },
  u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 }, normal: { x: 0, y: 1, z: 0 },
  width: 4, height: 4, cellSize: 1, scoring: true,
};
const wall: PaintSurface = { ...floor, id: "wall", boxId: "wall", scoring: false };
const arena: MapDefinition = {
  ...maps.construction,
  boxes: [{ ...maps.construction.boxes[0], center: { x: 0, y: -0.5, z: 0 }, size: { x: 4, y: 1, z: 4 } }],
  surfaces: [floor, wall],
};
const content = { weapons: { rifle: { ...weapons.rifle, spread: 0, paintRadius: 10 } } };

test("turf exposes both teams at zero before the first tick", () => {
  const s = new Simulation({ modeId: "turf", map: arena, teamMode: true });
  assert.deepEqual(s.getSnapshot().scores, { blue: 0, red: 0 });
  assert.equal(s.getSnapshot().remaining, 240);
});

test("turf reflects paint and ownership flips on the impact tick, and 100 percent is not an early win", () => {
  const s = new Simulation({ modeId: "turf", map: arena, teamMode: true, content });
  s.addPlayer("a", "甲", "assault", ["rifle"], "blue", { x: -1, y: 0, z: 1 });
  s.addPlayer("b", "乙", "assault", ["rifle"], "red", { x: 1, y: 0, z: -1 });
  s.step();
  s.input("a", { ...neutralInput(), seq: 1, primary: true, pitch: 1.5 });
  s.step();
  assert.deepEqual(s.getSnapshot().scores, { blue: 0, red: 0 });
  s.step();
  assert.deepEqual(s.getSnapshot().scores, { blue: 100, red: 0 });
  assert.equal(s.getSnapshot().phase, "playing");
  assert.equal(s.getSnapshot().winner, null);
  s.input("a", { ...neutralInput(), seq: 2 });
  s.input("b", { ...neutralInput(), seq: 1, primary: true, pitch: 1.5 });
  s.step();
  assert.deepEqual(s.getSnapshot().scores, { blue: 100, red: 0 });
  s.step();
  assert.deepEqual(s.getSnapshot().scores, { blue: 0, red: 100 });
  assert.equal(s.getSnapshot().phase, "playing");
});

test("wall ink contributes no turf area and an empty floor ends as a draw", () => {
  const paint = new PaintField(arena.surfaces, arena.boxes);
  paint.stamp("wall", floor.center, 10, "red", teamInk.red.color);
  const s = new Simulation({ modeId: "turf", map: arena, initialPaint: paint.snapshot() });
  s.advance(240);
  assert.deepEqual(s.getSnapshot().scores, { blue: 0, red: 0 });
  assert.equal(s.getSnapshot().winner, null);
});

test("the last 60 Hz tick's overpaint determines the 240-second winner and then freezes", () => {
  const paint = new PaintField(arena.surfaces, arena.boxes);
  paint.stamp("ground:top", floor.center, 10, "blue", teamInk.blue.color);
  const s = new Simulation({ modeId: "turf", map: arena, teamMode: true, content, initialPaint: paint.snapshot() });
  s.addPlayer("b", "乙", "assault", ["rifle"], "red", { x: 0, y: 0, z: 0 });
  s.advance(240 - 2 / 60);
  assert.equal(s.getSnapshot().phase, "playing");
  assert.equal(s.getSnapshot().scores.blue, 100);
  s.input("b", { ...neutralInput(), seq: 1, primary: true, pitch: 1.5 });
  s.step();
  assert.equal(s.getSnapshot().scores.blue, 100);
  assert.equal(s.getSnapshot().phase, "playing");
  s.step();
  const final = s.getSnapshot();
  assert.equal(final.remaining, 0);
  assert.equal(final.phase, "victory");
  assert.deepEqual(final.scores, { blue: 0, red: 100 });
  assert.equal(final.winner, "red");
  s.advance(1);
  assert.deepEqual(s.getSnapshot(), final);
});

test("equal covered floor areas produce no winner at the deadline", () => {
  const s = new Simulation({ modeId: "turf", map: arena, initialPaint: {
    revision: 1,
    surfaces: [{ id: "ground:top", revision: 1, cells: [
      [0, teamInk.blue.color, "blue"], [1, teamInk.red.color, "red"],
    ] }],
  } });
  s.advance(240);
  assert.deepEqual(s.getSnapshot().scores, { blue: 6.25, red: 6.25 });
  assert.equal(s.getSnapshot().winner, null);
});

test("full-map area preserves partial cells, covered-floor exclusions, restore and independent returned scores", () => {
  const partial = { ...floor, width: 2.5, height: 1.5 };
  const p = new PaintField([partial, wall]);
  p.stamp("ground:top", { x: 1.25, y: 0, z: -0.75 }, 0.1, "red", teamInk.red.color);
  assert.ok(Math.abs(p.coverage().red - 100 / 15) < 1e-10, "last corner cell is 0.25 of 3.75 square units");
  p.stamp("ground:top", { x: 1.25, y: 0, z: -0.75 }, 0.1, "blue", teamInk.blue.color);
  assert.equal(p.coverage().red ?? 0, 0);
  const saved = p.snapshot();
  p.stamp("ground:top", floor.center, 10, "red", teamInk.red.color);
  assert.equal(p.coverage().red, 100);
  p.restore(saved);
  assert.ok(Math.abs(p.coverage().blue - 100 / 15) < 1e-10);
  assert.equal(p.coverage().red ?? 0, 0);
  const returned = p.coverage(); returned.blue = -100;
  assert.ok(p.coverage().blue > 0);
  p.restore(saved);
  assert.ok(Math.abs(p.coverage().blue - 100 / 15) < 1e-10, "repeated restore must not accumulate area");
  const occluded = new PaintField([floor], [{ ...arena.boxes[0], id: "crate", center: { x: 0, y: 0.5, z: 0 }, size: { x: 2, y: 1, z: 2 } }]);
  occluded.stamp("ground:top", floor.center, 10, "blue", teamInk.blue.color);
  assert.equal(occluded.snapshot().surfaces[0].cells.length, 12);
  assert.equal(occluded.coverage().blue, 100, "covered cells are excluded from the denominator");
});

test("incremental full-map area agrees with an independent zone scan after repeated overpaint and restore", () => {
  const p = new PaintField([{ ...floor, width: 7.3, height: 5.4, cellSize: 0.6 }, wall]);
  const zone = { id: "all", name: "全部", center: floor.center, radius: 100 };
  for (let n = 0; n < 80; n++) {
    p.stamp(n % 9 === 0 ? "wall" : "ground:top", { x: Math.sin(n) * 3, y: 0, z: Math.cos(n * 2) * 2 }, 0.7 + (n % 3) / 5, n % 2 ? "blue" : "red", n);
    if (n % 11 === 0) p.restore(p.snapshot());
    const all = p.coverage(), scanned = p.coverage(zone);
    for (const owner of ["blue", "red"])
      assert.ok(Math.abs((all[owner] ?? 0) - (scanned[owner] ?? 0)) < 1e-9);
  }
});
