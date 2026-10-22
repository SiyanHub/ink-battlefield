import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { neutralInput } from "../src/shared/contracts";
import { maps, weapons } from "../src/content";
import { modeRegistry } from "../src/core/modes";
const arena = {
  ...maps.construction,
  id: "test",
  boxes: [maps.construction.boxes[0]],
  surfaces: maps.construction.surfaces.filter((s) => s.boxId === "ground"),
};
test("a player cannot change class alive, but death selection applies at the five-second respawn", () => {
  const s = new Simulation({
    modeId: "deathmatch",
    map: arena,
    content: { weapons: { rifle: { ...weapons.rifle, pvpDamage: 200 } } },
  });
  s.addPlayer("a", "甲", "assault", ["rifle"], "a", { x: 0, y: 0, z: 4 });
  s.addPlayer("b", "乙", "scout", ["revolver"], "b", { x: 0, y: 0, z: -4 });
  s.command("b", { type: "respawn", classId: "heavy", weapons: ["grenade"] });
  assert.equal(s.getSnapshot().actors[1].classId, "scout");
  s.advance(2);
  s.input("a", { ...neutralInput(), seq: 1, primary: true });
  s.step();
  s.input("a", { ...neutralInput(), seq: 2 });
  s.advance(.1);
  assert.equal(s.getSnapshot().actors[1].alive, false);
  s.command("b", { type: "respawn", classId: "heavy", weapons: ["grenade"] });
  s.advance(5.1);
  assert.equal(s.getSnapshot().actors[1].classId, "heavy");
  assert.equal(s.getSnapshot().actors[1].alive, true);
  assert.equal(s.getSnapshot().scores.a, 1);
});
test("a mode can be registered without changing the simulation loop and time-limit ties remain draws", () => {
  modeRegistry.register({
    id: "short-match",
    duration: 1,
    target: 3,
    title: "测试短局",
    update() {},
    onDeath() {},
  });
  const s = new Simulation({ modeId: "short-match", map: arena });
  s.addPlayer("a", "甲", "assault");
  s.advance(1.1);
  assert.equal(s.getSnapshot().phase, "victory");
  assert.equal(s.getSnapshot().winner, null);
});
test("class active skill obeys cooldown and repeated press cannot trigger a second dash", () => {
  const s = new Simulation({ modeId: "deathmatch", map: arena });
  s.addPlayer("a", "甲", "assault");
  s.input("a", { ...neutralInput(), seq: 1, skill: true });
  s.step();
  const cd = s.getSnapshot().actors[0].skillCooldown;
  assert.ok(cd >= 8);
  s.input("a", { ...neutralInput(), seq: 2, skill: true });
  s.step();
  assert.equal(s.getSnapshot().actors[0].skillCooldown, cd);
});
