import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { classes, maps, weapons } from "../src/content";
import { neutralInput, type ClassId, type GameEvent } from "../src/shared/contracts";

const colors = { blue: 0x1977bd, red: 0xe05b35 };
const arena = {
  ...maps.construction,
  boxes: [maps.construction.boxes[0]],
  surfaces: maps.construction.surfaces.filter(s => s.boxId === "ground"),
  anchors: [{ x: 0, y: 4, z: -8 }],
};

for (const [team, color] of Object.entries(colors)) {
  test(`${team} players share one ink identity across all four professions`, () => {
    const s = new Simulation({ modeId: "turf", map: arena, teamMode: true });
    for (const classId of Object.keys(classes) as ClassId[])
      s.addPlayer(classId, classId, classId, [], team);
    assert.deepEqual(s.getSnapshot().actors.map(a => a.color), [color, color, color, color]);
  });
  for (const weapon of Object.values(weapons)) {
    test(`${team} ${weapon.id} keeps shots, projectiles and painted cells in the team ink`, () => {
      const s = new Simulation({ modeId: "turf", map: arena, teamMode: true, seed: 19 });
      s.addPlayer("a", "甲", weapon.classId, [weapon.id], team, { x: 0, y: 0, z: 0 });
      const events: GameEvent[] = [];
      s.input("a", { ...neutralInput(), seq: 1, slot: weapon.melee ? 2 : 0 });
      s.advance(0.3);
      s.input("a", { ...neutralInput(), seq: 2, primary: true, pitch: 1.3 });
      for (let i = 0; i < 75; i++) { s.step(); events.push(...s.takeFrame().events); }
      s.input("a", { ...neutralInput(), seq: 3, pitch: 1.3 });
      for (let i = 0; i < 60; i++) { s.step(); events.push(...s.takeFrame().events); }
      const shots = events.filter(e => e.type === "shot" && e.weaponId === weapon.id);
      assert.ok(shots.length > 0, "fixture must fire the selected weapon");
      assert.ok(shots.every(e => e.color === color), "every shot uses the same team color");
      const cells = s.getSnapshot().paint.surfaces.flatMap(surface => surface.cells);
      assert.ok(cells.length > 0, "fixture must paint actual geometry");
      assert.ok(cells.every(cell => cell[1] === color && cell[2] === team));
      assert.ok(events.filter(e => e.type === "paint").every(e => e.color === color));
    });
  }
  test(`${team} bloom and grapple effects retain their actor's ink identity`, () => {
    const s = new Simulation({ modeId: "turf", map: arena, teamMode: true });
    s.addPlayer("a", "甲", "artist", [], team, { x: 0, y: 0, z: 0 });
    s.input("a", { ...neutralInput(), seq: 1, skill: true, grapple: true, pitch: -0.29 });
    s.step();
    const frame = s.takeFrame();
    assert.ok(frame.events.some(e => e.type === "paint"));
    assert.ok(frame.events.some(e => e.type === "grapple"));
    assert.ok(frame.events.filter(e => ["paint", "skill", "grapple"].includes(e.type)).every(e => e.color === color));
    assert.ok(frame.snapshot.paint.surfaces.flatMap(surface => surface.cells).every(cell => cell[1] === color));
  });
}

for (const modeId of ["solo", "practice"]) {
  test(`${modeId} keeps a fixed profession color across repeated fire and bloom`, () => {
    const s = new Simulation({ modeId, map: arena, seed: 19 });
    s.addPlayer("a", "甲", "artist", ["pencil"], "player", { x: 0, y: 0, z: 0 });
    s.input("a", { ...neutralInput(), seq: 1, primary: true, skill: true, pitch: 1.3 });
    s.advance(0.8);
    const frame = s.takeFrame();
    assert.ok(frame.events.filter(e => e.type === "shot").length > 1);
    assert.ok(frame.events.filter(e => e.type === "shot" || e.type === "paint").every(e => e.color === classes.artist.color));
    assert.ok(frame.snapshot.paint.surfaces.flatMap(surface => surface.cells).every(cell => cell[1] === classes.artist.color));
  });
}

test("cluster grenade fragments keep their parent's fixed ink", () => {
  const s = new Simulation({ modeId: "solo", map: arena, seed: 7, campaign: { completed: 0, upgrades: ["cluster"], groups: 1 } });
  s.addPlayer("a", "甲", "heavy", ["grenade"], "player", { x: 0, y: 0, z: 0 });
  s.input("a", { ...neutralInput(), seq: 1, primary: true, pitch: 1.3 });
  s.advance(0.4);
  const frame = s.takeFrame();
  assert.equal(frame.events.filter(e => e.type === "shot").length, 1, "fragments must not repeat the shooter's muzzle sound and recoil");
  assert.equal(frame.snapshot.projectiles.length, 3, "the explosion must launch three real fragments");
  assert.ok(frame.events.filter(e => e.type === "shot").every(e => e.color === classes.heavy.color));
  assert.ok(frame.snapshot.projectiles.every(p => p.color === classes.heavy.color));
});
