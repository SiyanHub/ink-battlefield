import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Simulation } from "../src/core/simulation";
import { weapons, maps } from "../src/content";
import { neutralInput } from "../src/shared/contracts";

// A repeatable public-API smoke check, not a weapon balance or full-map test.
const arena = {
  ...maps.construction,
  id: "weapon-audit",
  boxes: [maps.construction.boxes[0]],
  surfaces: maps.construction.surfaces.filter((s) => s.boxId === "ground"),
};
const results = [];
for (const w of Object.values(weapons)) {
  const sim = new Simulation({ modeId: "deathmatch", map: arena, seed: 7 });
  sim.addPlayer("tester", "验收", w.classId, [w.id], "player", {
    x: 0,
    y: 0,
    z: 2.4,
  });
  const enemy = sim.addEnemy("brute", { x: 0, y: 0, z: 0 })!;
  let seq = 0;
  if (w.melee) {
    sim.input("tester", { ...neutralInput(), seq: ++seq, slot: 2 });
    sim.advance(0.3);
  }
  sim.input("tester", { ...neutralInput(), seq: ++seq, primary: true });
  sim.advance(w.charge ?? 0.1);
  sim.input("tester", { ...neutralInput(), seq: ++seq });
  sim.advance(0.5);
  const after = sim.takeFrame(),
    p = after.snapshot.actors.find((a) => a.id === "tester")!,
    target = after.snapshot.actors.find((a) => a.id === enemy)!;
  assert.ok(target.hp < target.maxHp, `${w.id} did not damage the target`);
  assert.ok(
    after.events.some((e) => e.type === "shot" && e.weaponId === w.id),
    `${w.id} missing shot feedback`,
  );
  const spent = w.capacity - p.ammo[w.id].clip;
  if (!w.melee) {
    assert.ok(spent > 0, `${w.id} ammunition not consumed`);
    sim.input("tester", { ...neutralInput(), seq: ++seq, reload: true });
    sim.advance(w.reload + 0.1);
    assert.equal(
      sim.getSnapshot().actors.find((a) => a.id === "tester")!.ammo[w.id].clip,
      w.capacity,
      `${w.id} reload failed`,
    );
  }
  sim.input("tester", {
    ...neutralInput(),
    seq: ++seq,
    primary: true,
    pitch: 1.2,
  });
  sim.advance(w.charge ?? 0.1);
  sim.input("tester", { ...neutralInput(), seq: ++seq, pitch: 1.2 });
  sim.advance(1.2);
  const floorCells = sim
    .getSnapshot()
    .paint.surfaces.reduce((n, s) => n + s.cells.length, 0);
  assert.ok(floorCells > 0, w.id + " did not leave persistent floor paint");
  results.push({
    floorCells,
    id: w.id,
    name: w.name,
    behavior: w.behavior,
    damage: target.maxHp - target.hp,
    ammunitionSpent: spent,
    reload: w.melee ? "not applicable" : "passed",
    shotEvents: after.events.filter((e) => e.type === "shot").length,
  });
}
writeFileSync(
  "artifacts/weapon-audit.json",
  JSON.stringify(
    {
      scope:
        "16 default weapons; isolated ground arena; authoritative public input; stationary heavy target; not difficulty balance",
      results,
    },
    null,
    2,
  ),
);
console.log(
  `${results.length} weapons: damage, feedback, ammo and reload checks passed.`,
);
