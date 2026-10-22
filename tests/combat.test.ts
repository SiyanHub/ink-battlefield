import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { neutralInput } from "../src/shared/contracts";
import { maps, enemies } from "../src/content";
const arena = {
  ...maps.construction,
  id: "test",
  boxes: [maps.construction.boxes[0]],
  surfaces: maps.construction.surfaces.filter((s) => s.boxId === "ground"),
};

test("a shot above the smaller paper operator head misses instead of hitting the old oversized sphere", () => {
  const s=new Simulation({modeId:"deathmatch",map:arena,seed:7});
  s.addPlayer("a","射手","scout",["sniper"],"a",{x:0,y:0,z:8});
  s.addPlayer("b","目标","assault",["rifle"],"b",{x:0,y:0,z:0});
  s.advance(2);
  s.input("a",{...neutralInput(),seq:1,primary:true,pitch:-Math.atan2(1.77-1.62,8)});
  s.step();
  s.advance(.1);
  assert.equal(s.getSnapshot().actors.find(a=>a.id==="b")!.hp,100);
});

test("boss head hit volume follows its height rather than inflating with its broad shoulders", () => {
  const s=new Simulation({modeId:"deathmatch",map:arena,seed:7});
  s.addPlayer("a","射手","scout",["sniper"],"a",{x:0,y:0,z:8});
  const id=s.addEnemy("doodler",{x:0,y:0,z:0});
  s.input("a",{...neutralInput(),seq:1,primary:true,pitch:-Math.atan2(3.7-1.62,8)});
  s.step();
  s.advance(.1);
  assert.equal(s.getSnapshot().actors.find(a=>a.id===id)!.hp,3600);
});
test("an offensive class skill ends spawn protection immediately", () => {
  const s = new Simulation({ modeId: "deathmatch", map: arena });
  s.addPlayer("a", "画师", "artist");
  s.input("a", { ...neutralInput(), seq: 1, skill: true });
  s.step();
  const snapshot = s.getSnapshot();
  assert.ok(snapshot.actors[0].protectedUntil <= snapshot.time);
});
test("authoritative inputs consume ammunition once per fire interval and deal damage through shared simulation", () => {
  const sim = new Simulation({ modeId: "deathmatch", map: arena, seed: 7 });
  sim.addPlayer("a", "甲", "assault", ["rifle"], "a", { x: 0, y: 0, z: 4 });
  sim.addPlayer("b", "乙", "scout", ["revolver"], "b", { x: 0, y: 0, z: -4 });
  sim.advance(2);
  sim.input("a", { ...neutralInput(), seq: 1, primary: true });
  sim.step();
  assert.equal(
    sim.getSnapshot().actors.find((a) => a.id === "a")!.ammo.rifle.clip,
    29,
  );
  sim.step();
  assert.equal(
    sim.getSnapshot().actors.find((a) => a.id === "a")!.ammo.rifle.clip,
    29,
  );
  assert.equal(sim.getSnapshot().actors.find((a) => a.id === "b")!.hp, 100);
  sim.advance(.05);
  assert.ok(sim.getSnapshot().actors.find((a) => a.id === "b")!.hp < 100);
  sim.input("a", { ...neutralInput(), seq: 1, primary: true, slot: 2 });
  sim.step();
  assert.equal(
    sim.getSnapshot().actors.find((a) => a.id === "a")!.weaponId,
    "rifle",
    "repeated input is ignored",
  );
});
test("charged bow waits for release, consumes an arrow and creates a moving projectile", () => {
  const sim = new Simulation({ modeId: "deathmatch", map: arena, seed: 1 });
  sim.addPlayer("a", "弓手", "scout", ["bow"]);
  sim.input("a", { ...neutralInput(), seq: 1, primary: true });
  sim.advance(0.7);
  assert.equal(sim.getSnapshot().actors[0].ammo.bow.clip, 8);
  sim.input("a", { ...neutralInput(), seq: 2 });
  sim.step();
  assert.equal(sim.getSnapshot().actors[0].ammo.bow.clip, 7);
  assert.equal(sim.getSnapshot().projectiles.length, 1);
});
test("three-round burst consumes three rounds and roller paints floor while swinging", () => {
  const sim = new Simulation({ modeId: "deathmatch", map: arena, seed: 1 });
  sim.addPlayer("a", "甲", "assault", ["carbine"]);
  sim.input("a", { ...neutralInput(), seq: 1, primary: true });
  sim.advance(0.4);
  assert.equal(sim.getSnapshot().actors[0].ammo.carbine.clip, 21);
  const paint = new Simulation({ modeId: "deathmatch", map: arena });
  paint.addPlayer("p", "画师", "artist", ["pencil"]);
  paint.input("p", { ...neutralInput(), seq: 1, slot: 2, primary: true });
  paint.advance(0.5);
  assert.ok(paint.getSnapshot().paint.surfaces.some((s) => s.cells.length > 0));
});
test("a kill preserves the enlarged magazine and refills only the configured amount", () => {
  const sim = new Simulation({
    modeId: "solo",
    map: arena,
    seed: 7,
    campaign: { completed: 0, upgrades: ["magazine"], groups: 0 },
    content: {
      enemies: {
        target: { ...enemies.grunt, id: "target", hp: 1, speed: 0, damage: 0 },
      },
    },
  });
  sim.addPlayer("a", "甲", "assault", ["rifle"], "a", { x: 0, y: 0, z: 4 });
  sim.addEnemy("target", { x: 0, y: 0, z: -4 });
  sim.input("a", { ...neutralInput(), seq: 1, reload: true });
  sim.advance(2);
  assert.equal(
    sim.getSnapshot().actors.find((a) => a.id === "a")!.ammo.rifle.clip,
    38,
  );
  sim.input("a", { ...neutralInput(), seq: 2, primary: true });
  sim.step();
  sim.input("a", { ...neutralInput(), seq: 3 });
  sim.advance(.12);
  assert.equal(sim.getSnapshot().actors.find((a) => a.id === "a")!.kills, 1);
  assert.equal(
    sim.getSnapshot().actors.find((a) => a.id === "a")!.ammo.rifle.clip,
    37,
  );
});
test("one-shot inputs survive multiple render submissions before the next simulation tick", () => {
  const sim = new Simulation({ modeId: "deathmatch", map: arena });
  sim.addPlayer("a", "甲", "assault");
  sim.input("a", { ...neutralInput(), seq: 1, jump: true });
  sim.input("a", { ...neutralInput(), seq: 2 });
  sim.step();
  assert.ok(
    sim.getSnapshot().actors[0].vel.y > 0,
    "jump must not disappear at high render rates",
  );
});
test("wide paint upgrades expand projectile impact coverage", () => {
  const shot = (upgrades: string[]) => {
    const s = new Simulation({
      modeId: "solo",
      map: arena,
      seed: 7,
      campaign: { completed: 0, upgrades, groups: 1 },
    });
    s.addPlayer("a", "甲", "artist", ["pencil"], "a", { x: 0, y: 0, z: 4 });
    s.input("a", { ...neutralInput(), seq: 1, primary: true, pitch: 1.2 });
    s.step();
    s.input("a", { ...neutralInput(), seq: 2, pitch: 1.2 });
    s.advance(0.2);
    return s
      .getSnapshot()
      .paint.surfaces.reduce((n, p) => n + p.cells.length, 0);
  };
  assert.ok(shot(["paint", "paint", "paint"]) > shot([]) * 1.8);
});
test("a large enemy can be hit at its visible head height", () => {
  const s = new Simulation({ modeId: "deathmatch", map: arena, seed: 7 });
  s.addPlayer("a", "甲", "scout", ["sniper"], "a", { x: 0, y: 0, z: 8 });
  const id = s.addEnemy("doodler", { x: 0, y: 0, z: 0 });
  const pitch = -Math.atan2(1.52 * 1.9 - 1.62, 8);
  s.input("a", { ...neutralInput(), seq: 1, primary: true, pitch });
  s.step();
  s.advance(.1);
  assert.ok(
    s.getSnapshot().actors.find((a) => a.id === id)!.hp < 3500,
    "headshot lands at the rendered head, not an unrelated sphere",
  );
});
test("dash follows the requested strafe direction", () => {
  const s = new Simulation({ modeId: "deathmatch", map: arena });
  s.addPlayer("a", "甲", "assault", ["rifle"], "a", { x: 0, y: 0, z: 8 });
  s.input("a", { ...neutralInput(), seq: 1, moveX: 1, skill: true });
  s.advance(0.1);
  const a = s.getSnapshot().actors[0];
  assert.ok(a.pos.x > 1);
  assert.ok(Math.abs(a.pos.z - 8) < 0.1);
});
test("projectiles collide with the visible head above a heavy enemy torso", () => {
  const s = new Simulation({ modeId: "deathmatch", map: arena, seed: 1 });
  s.addPlayer("a", "甲", "artist", ["pencil"], "a", { x: 0, y: 0, z: 8 });
  const id = s.addEnemy("brute", { x: 0, y: 0, z: 0 });
  const pitch = -Math.atan2(2.888 - 1.62, 8);
  s.input("a", { ...neutralInput(), seq: 1, primary: true, pitch });
  s.step();
  s.input("a", { ...neutralInput(), seq: 2, pitch });
  s.advance(0.25);
  assert.ok(s.getSnapshot().actors.find((a) => a.id === id)!.hp < 280);
});
test("a new encounter supplies the full upgraded magazine immediately", () => {
  const s = new Simulation({
    modeId: "solo",
    map: arena,
    campaign: { completed: 1, upgrades: ["magazine"], groups: 1 },
  });
  s.addPlayer("a", "甲", "assault", ["rifle"]);
  assert.equal(s.getSnapshot().actors[0].ammo.rifle.clip, 38);
});
