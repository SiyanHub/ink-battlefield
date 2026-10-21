import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { maps, enemies } from "../src/content";
test("single-player encounters spawn actual attackers and the campaign exposes the first objective", () => {
  const s = new Simulation({
    modeId: "solo",
    mapId: "construction",
    seed: 7,
    campaign: { completed: 0, upgrades: [] },
  });
  s.addPlayer("p", "玩家", "assault", ["rifle"], "player");
  s.advance(1.5);
  const snap = s.getSnapshot();
  assert.equal(snap.campaign?.chapter, 0);
  assert.equal(snap.campaign?.encounter, 0);
  assert.ok(snap.actors.some((a) => a.kind === "enemy" && a.alive));
  assert.ok(snap.objective.target > 0);
});
test("AI telegraphs a melee attack and damages the player through real simulation", () => {
  const arena = { ...maps.construction, boxes: [maps.construction.boxes[0]] };
  const s = new Simulation({ modeId: "solo", map: arena });
  s.addPlayer("p", "玩家", "assault", ["rifle"], "player", {
    x: 0,
    y: 0,
    z: 0,
  });
  s.addEnemy("grunt", { x: 0, y: 0, z: -1.5 });
  s.advance(4);
  assert.ok(s.getSnapshot().actors.find((a) => a.id === "p")!.hp < 100);
});
test("the final wave must be defeated before offering an upgrade", () => {
  const s = new Simulation({
    modeId: "solo",
    mapId: "construction",
    seed: 7,
    campaign: { completed: 0, upgrades: [], groups: 1 },
  });
  s.addPlayer("p", "玩家", "assault", ["rifle"], "player");
  s.advance(0.7);
  assert.ok(s.getSnapshot().actors.some((a) => a.kind === "enemy" && a.alive));
  assert.equal(s.getSnapshot().phase, "playing");
});
test("street melee enemies can walk from the ground onto an occupied rooftop", () => {
  const s = new Simulation({
    modeId: "solo",
    mapId: "street",
    content: { enemies: { grunt: { ...enemies.grunt, damage: 0 } } },
  });
  s.addPlayer("p", "玩家", "assault", ["rifle"], "player", {
    x: -13,
    y: 4.2,
    z: -16,
  });
  const id = s.addEnemy("grunt", { x: -13, y: 0, z: 2 });
  s.advance(40);
  const a = s.getSnapshot().actors.find((a) => a.id === id)!;
  assert.ok(a.pos.y >= 4, "the roof remains reachable for non-flying enemies");
});
