import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { classes, maps, weapons } from "../src/content";
import { surfacesForBox } from "../src/content/maps";
import { neutralInput } from "../src/shared/contracts";
import { Simulation } from "../src/core/simulation";
import { ProfileStore } from "../src/profile/store";
import { buildWeapon } from "../src/client/weapons";
import { dispose } from "../src/client/primitives";

const additions = {
  assault: ["dual", "scatter"], heavy: ["rocket", "minigun"],
  scout: ["crossbow", "nailgun"], artist: ["bucket", "bubble"],
} as const;

test("twenty-four weapons are open immediately and each class can equip its two new primaries", () => {
  assert.equal(Object.keys(weapons).length, 24);
  const store = new ProfileStore();
  for (const classId of Object.keys(additions) as (keyof typeof additions)[]) {
    assert.equal(classes[classId].weapons.length, 5);
    const requested = [...additions[classId]];
    for (const id of requested) assert.ok(store.unlockedWeapons(classId).includes(id));
    const sim = new Simulation({ modeId: "practice" });
    sim.addPlayer("p", "玩家", classId, requested);
    const player = sim.getSnapshot().actors.find(actor => actor.id === "p")!;
    assert.deepEqual(player.weapons, [...requested, classes[classId].melee]);
    for (const id of requested) assert.equal(player.ammo[id].clip, weapons[id].capacity);
  }
});

for (const [id, count] of [["dual", 2], ["scatter", 5], ["rocket", 1], ["minigun", 1],
  ["crossbow", 1], ["nailgun", 1], ["bucket", 3], ["bubble", 1]] as const)
  test(`${id} launches its real ink, damages only after flight, and paints on arrival`, () => {
    const weapon = weapons[id], ground = maps.construction.boxes.find(box => box.id === "ground")!;
    const sim = new Simulation({ modeId: "turf", seed: 7,
      map: { ...maps.construction, boxes: [ground], surfaces: surfacesForBox(ground) } });
    sim.addPlayer("p", "玩家", weapon.classId, [id], "blue", { x: 0, y: 0, z: 0 });
    sim.addPlayer("target", "目标", "assault", [], "red", { x: 0, y: 0, z: -6 });
    sim.advance(2);
    sim.input("p", { ...neutralInput(), seq: 1, pitch: Math.atan2(.5, 6), primary: true }); sim.step();
    const first = sim.getSnapshot();
    assert.equal(first.projectiles.length, count);
    assert.ok(first.projectiles.every(p => p.weaponId === id));
    assert.equal(first.actors.find(a => a.id === "target")!.hp, 100);
    assert.equal(first.actors.find(a => a.id === "p")!.ammo[id].clip, weapon.capacity - 1);
    sim.input("p", { ...neutralInput(), seq: 2 }); sim.advance(1.5);
    assert.ok(sim.getSnapshot().actors.find(a => a.id === "target")!.hp < 100);
    sim.input("p", { ...neutralInput(), seq: 3, pitch: 1.3, primary: true }); sim.step();
    sim.input("p", { ...neutralInput(), seq: 4, pitch: 1.3 }); sim.advance(1.5);
    assert.ok(sim.getSnapshot().scores.blue > 0, "the same weapon must apply floor ink through collision");
  });

const signatures = {
  dual: ["left-pistol", "right-pistol"], scatter: ["chamber-bank", "rear-magazine"],
  rocket: ["launch-tube", "exhaust-bell"], minigun: ["barrel-cluster", "ammo-drum"],
  crossbow: ["crossbow-limbs", "crossbow-string"], nailgun: ["pressure-tank", "nail-rail"],
  bucket: ["bucket-body", "bucket-handle"], bubble: ["bubble-reservoir", "bubble-wand"],
};
for (const [id, parts] of Object.entries(signatures)) test(`${id} has a distinct physical silhouette and usable hand/muzzle anchors`, () => {
  assert.ok(weapons[id], `${id} must be registered`);
  const model = buildWeapon(weapons[id]);
  try {
    for (const name of parts) assert.ok(model.getObjectByName(name), `missing visible ${name}`);
    for (const name of ["grip-anchor", "support-anchor", "muzzle"]) {
      const anchor = model.getObjectByName(name);
      assert.ok(anchor, `missing ${name}`);
      assert.ok(anchor.position.toArray().every(Number.isFinite));
    }
    const grip = model.getObjectByName("grip-anchor")!, muzzle = model.getObjectByName("muzzle")!;
    assert.ok(muzzle.position.z < grip.position.z - .15, "working end must point away from the hands");
    const bounds = new T.Box3().setFromObject(model), size = bounds.getSize(new T.Vector3());
    assert.ok(size.x > .1 && size.x < 1.2, `weapon width ${size.x}`);
    assert.ok(size.y > .15 && size.y < 1, `weapon height ${size.y}`);
    assert.ok(size.z > .35 && size.z < 1.6, `weapon length ${size.z}`);
  } finally { dispose(model); }
});
