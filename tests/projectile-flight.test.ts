import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { enemies, maps, weapons } from "../src/content";
import { surfacesForBox } from "../src/content/maps";
import { neutralInput, type BoxDefinition, type GameSnapshot, type WeaponDefinition } from "../src/shared/contracts";

const ground = maps.construction.boxes.find(box => box.id === "ground")!;
const arena = { ...maps.construction, boxes: [ground], surfaces: surfacesForBox(ground) };
const actor = (s: GameSnapshot, id: string) => s.actors.find(a => a.id === id)!;
function duel(overrides: Partial<WeaponDefinition> = {}, map = arena) {
  const s = new Simulation({ modeId: "deathmatch", map, seed: 7, content: { weapons: {
    rifle: { ...weapons.rifle, automatic: false, spread: 0, speed: 30, pvpDamage: 20, ...overrides },
  } } });
  s.addPlayer("a", "射手", "assault", ["rifle"], "blue", { x: 0, y: 0, z: 0 });
  s.addPlayer("b", "目标", "assault", ["rifle"], "red", { x: 0, y: 0, z: -12 });
  s.advance(2);
  return s;
}

for (const behavior of ["hitscan", "burst", "pellets", "spray", "beam"])
  test(`${behavior} launches visible moving ink and applies damage only after flight`, () => {
    const s = duel({ behavior, pellets: 3 });
    s.input("a", { ...neutralInput(), seq: 1, primary: true });
    s.step();
    const first = s.takeFrame();
    assert.equal(actor(first.snapshot, "b").hp, 100, "triggering is not a remote hit");
    assert.equal(first.events.filter(e => e.type === "hit").length, 0);
    assert.equal(first.events.filter(e => e.type === "shot").length, 1, "one trigger has one muzzle/recoil/audio event");
    assert.equal(first.snapshot.projectiles.length, ["pellets", "spray"].includes(behavior) ? 3 : 1);
    const births = first.events.filter(event => event.type === "projectile");
    assert.equal(births.length, first.snapshot.projectiles.length, "each pellet owns a flight record independent of muzzle effects");
    assert.ok(first.snapshot.projectiles.every(p => p.weaponId === "rifle" && p.vel.z === -30));
    s.input("a", { ...neutralInput(), seq: 2 });
    s.advance(.1);
    const flying = s.getSnapshot();
    assert.equal(actor(flying, "b").hp, 100);
    assert.ok(flying.projectiles[0].pos.z < first.snapshot.projectiles[0].pos.z - 2);
    assert.ok(births.every(event => event.projectile!.pos.z === 0), "moving authoritative state cannot mutate the published birth point");
    s.advance(.35);
    assert.ok(actor(s.getSnapshot(), "b").hp < 100, "the arriving ink applies authoritative damage");
  });

test("pellets read content speed, gravity and visible radius", () => {
  const s = duel({ behavior: "pellets", speed: 18, gravity: 10, projectileRadius: .12, pellets: 3 });
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  const p = s.getSnapshot().projectiles;
  assert.equal(p.length, 3);
  assert.ok(p.every(q => q.radius === .12 && q.vel.y < 0 && q.vel.z === -18));
  const initialY = p[0].pos.y;
  s.advance(.1);
  assert.ok(s.getSnapshot().projectiles[0].pos.y < initialY);
});

const wall: BoxDefinition = { id: "thin-wall", center: { x: 0, y: 1.5, z: -6 }, size: { x: 8, y: 3, z: .02 } };
const walled = { ...arena, boxes: [ground, wall], surfaces: [...arena.surfaces, ...surfacesForBox(wall)] };
test("fast ink sweeps through its whole step and cannot tunnel through a thin wall", () => {
  const s = duel({ speed: 2000 }, walled);
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  const frame = s.takeFrame();
  assert.equal(actor(frame.snapshot, "b").hp, 100);
  assert.equal(frame.snapshot.projectiles.length, 0);
  assert.ok(frame.snapshot.paint.surfaces.some(surface => surface.id === "thin-wall:south"));
  const end = frame.events.filter(event => event.type === "projectile-end");
  assert.equal(end.length, 1);
  assert.ok(Math.abs(end[0].pos!.z + 5.99) < .0001, "the terminal point is the wall surface, not the discarded frame end");
});

test("a wall gains no paint until the projectile reaches it", () => {
  const s = duel({ speed: 30 }, walled);
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  assert.equal(s.getSnapshot().paint.surfaces.length, 0);
  s.input("a", { ...neutralInput(), seq: 2 }); s.advance(.25);
  assert.ok(s.getSnapshot().paint.surfaces.some(surface => surface.id === "thin-wall:south"));
});

test("an actor in front of a wall consumes a non-piercing projectile without painting the wall behind", () => {
  const s = duel({ behavior: "projectile", speed: 2000, pvpDamage: 10 }, walled);
  s.addPlayer("near", "近目标", "assault", [], "red", { x: 0, y: 0, z: -3 }); s.advance(2);
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  assert.ok(actor(s.getSnapshot(), "near").hp < 100);
  assert.equal(s.getSnapshot().paint.surfaces.length, 0, "a hit actor must not also stamp a later wall intersection");
});

test("player ink stops on a teammate without damage or passing through to an opponent", () => {
  const s = duel({ speed: 60 });
  s.addPlayer("friend", "队友", "artist", [], "blue", { x: 0, y: 0, z: -4 }); s.advance(2);
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  s.input("a", { ...neutralInput(), seq: 2 }); s.advance(.3);
  const frame = s.takeFrame();
  assert.equal(actor(frame.snapshot, "friend").hp, 100);
  assert.equal(actor(frame.snapshot, "b").hp, 100);
  assert.equal(frame.snapshot.projectiles.length, 0);
  assert.equal(frame.events.filter(e => e.type === "hit").length, 0);
  assert.equal(frame.events.filter(e => e.type === "projectile-end").length, 1, "allied contact also closes the presentation segment");
});

test("ink originating inside an overlapping teammate still cannot pass through them", () => {
  const s = duel({ speed: 60 });
  s.addPlayer("friend", "重叠队友", "artist", [], "blue", { x: 0, y: 0, z: 0 }); s.advance(2);
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  s.input("a", { ...neutralInput(), seq: 2 }); s.advance(.3);
  assert.equal(actor(s.getSnapshot(), "friend").hp, 100);
  assert.equal(actor(s.getSnapshot(), "b").hp, 100);
  assert.equal(s.getSnapshot().projectiles.length, 0);
  const ends = s.takeFrame().events.filter(event => event.type === "projectile-end");
  assert.equal(ends.length, 1);
  assert.equal(ends[0].pos!.z, 0, "an inside contact ends at the muzzle instead of crossing the ally");
});

test("lifetime expiry ends a surviving flight record without creating a hit", () => {
  const s = duel({ speed: 1, range: 1000 });
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  s.input("a", { ...neutralInput(), seq: 2 }); s.advance(5.1);
  const frame = s.takeFrame();
  assert.equal(frame.snapshot.projectiles.length, 0);
  assert.equal(frame.events.filter(event => event.type === "hit").length, 0);
  const births = frame.events.filter(event => event.type === "projectile"), ends = frame.events.filter(event => event.type === "projectile-end");
  assert.equal(births.length, 1); assert.equal(ends.length, 1);
  assert.equal(ends[0].projectileId, births[0].projectile!.id);
  assert.ok(ends[0].pos!.z < -4.9 && ends[0].pos!.z > -5.1);
});

test("a non-charge beam flies through two targets once each and spends its penetration budget", () => {
  const s = duel({ behavior: "beam", speed: 12, pvpDamage: 10 });
  s.addPlayer("near", "近目标", "assault", [], "red", { x: 0, y: 0, z: -3 });
  s.addPlayer("middle", "中目标", "assault", [], "red", { x: 0, y: 0, z: -6 }); s.advance(2);
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  assert.equal(actor(s.getSnapshot(), "near").hp, 100);
  s.input("a", { ...neutralInput(), seq: 2 }); s.advance(1.2);
  const hits = s.takeFrame().events.filter(e => e.type === "hit");
  assert.deepEqual(hits.map(e => e.targetId), ["near", "middle"]);
  assert.equal(actor(s.getSnapshot(), "near").hp, 85);
  assert.equal(actor(s.getSnapshot(), "middle").hp, 85);
  assert.equal(actor(s.getSnapshot(), "b").hp, 100);
});

test("projectiles exhaust their configured range instead of travelling for a spare second", () => {
  const s = duel({ behavior: "projectile", range: 5, speed: 30 });
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  s.input("a", { ...neutralInput(), seq: 2 }); s.advance(.5);
  assert.equal(actor(s.getSnapshot(), "b").hp, 100);
  assert.equal(s.getSnapshot().projectiles.length, 0);
  const ends = s.takeFrame().events.filter(event => event.type === "projectile-end");
  assert.equal(ends.length, 1);
  assert.ok(Math.abs(ends[0].pos!.z + 5) < .0001);
});

test("a shot already in flight can finish its kill after its shooter dies", () => {
  const s = new Simulation({ modeId: "deathmatch", map: arena, content: { weapons: {
    rifle: { ...weapons.rifle, automatic: false, speed: 60, spread: 0, pvpDamage: 200 },
    revolver: { ...weapons.revolver, speed: 120, spread: 0, pvpDamage: 200 },
  } } });
  s.addPlayer("a", "慢弹", "assault", ["rifle"], "blue", { x: 0, y: 0, z: 0 });
  s.addPlayer("b", "快弹", "scout", ["revolver"], "red", { x: 0, y: 0, z: -12 }); s.advance(2);
  s.input("a", { ...neutralInput(), seq: 1, primary: true });
  s.input("b", { ...neutralInput(), seq: 1, primary: true, yaw: Math.PI }); s.advance(.12);
  assert.equal(actor(s.getSnapshot(), "a").alive, false);
  assert.equal(actor(s.getSnapshot(), "b").alive, true);
  s.advance(.15);
  const frame = s.takeFrame();
  assert.equal(actor(frame.snapshot, "b").alive, false);
  assert.equal(actor(frame.snapshot, "a").kills, 1);
  assert.equal(frame.events.filter(e => e.type === "death").length, 2);
  for (const event of frame.events.filter(e => e.type === "hit" || e.type === "death")) {
    assert.equal(event.weaponId, event.actorId === "a" ? "rifle" : "revolver");
    assert.ok(Math.abs(event.normal!.z - (event.actorId === "a" ? 1 : -1)) < .0001);
  }
});

test("an arriving explosive damages its direct and exposed targets once, but not its shooter, allies or targets behind cover", () => {
  const cover: BoxDefinition = { id: "cover", center: { x: 1.5, y: 1.5, z: -3 }, size: { x: .1, y: 3, z: 4 } };
  const s = new Simulation({ modeId: "deathmatch", map: {
    ...arena, boxes: [ground, cover], surfaces: [...arena.surfaces, ...surfacesForBox(cover)],
  }, content: { weapons: { rifle: { ...weapons.rifle, behavior: "projectile", automatic: false, spread: 0, speed: 30, splash: 4, pvpDamage: 40 } } } });
  for (const [id, x, z, team] of [["a", 0, 0, "blue"], ["direct", 0, -3, "red"], ["friend", 1, -3, "blue"], ["splash", -2, -3, "red"], ["covered", 2, -3, "red"]] as const)
    s.addPlayer(id, id, "assault", ["rifle"], team, { x, y: 0, z });
  s.advance(2);
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  assert.equal(actor(s.getSnapshot(), "direct").hp, 100);
  s.input("a", { ...neutralInput(), seq: 2 }); s.advance(.15);
  const frame = s.takeFrame();
  assert.equal(actor(frame.snapshot, "direct").hp, 60, "the direct target does not also receive splash damage");
  assert.ok(actor(frame.snapshot, "splash").hp < 100);
  for (const id of ["a", "friend", "covered"]) assert.equal(actor(frame.snapshot, id).hp, 100, id);
  assert.equal(frame.events.filter(e => e.type === "skill" && e.text === "爆破").length, 1);
  assert.ok(frame.snapshot.paint.surfaces.some(surface => surface.id === "ground:top"));
});

test("ricochet growth reflects the same flying ink once with reduced damage and no extra muzzle event", () => {
  const s = new Simulation({ modeId: "solo", map: walled,
    campaign: { completed: 0, upgrades: ["ricochet"], groups: 1 },
    content: { weapons: { rifle: { ...weapons.rifle, automatic: false, spread: 0, speed: 60, damage: 20 } },
      enemies: { grunt: { ...enemies.grunt, speed: 0, damage: 0 } } } });
  s.addPlayer("a", "反弹", "assault", ["rifle"], "blue", { x: 0, y: 0, z: 0 });
  const target = s.addEnemy("grunt", { x: 0, y: 0, z: 3 })!;
  s.input("a", { ...neutralInput(), seq: 1, primary: true }); s.step();
  const firstId = s.getSnapshot().projectiles[0].id;
  s.input("a", { ...neutralInput(), seq: 2 }); s.advance(.1);
  const bounce = s.getSnapshot();
  assert.equal(bounce.projectiles[0].id, firstId);
  assert.ok(bounce.projectiles[0].vel.z > 0);
  assert.equal(actor(bounce, target).hp, enemies.grunt.hp);
  s.advance(.2);
  const frame = s.takeFrame(), hits = frame.events.filter(e => e.type === "hit" && e.targetId === target);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].amount, 18, "20 damage × 60% bounce × 1.5 head multiplier");
  assert.equal(frame.events.filter(e => e.type === "shot").length, 1);
  assert.equal(frame.snapshot.projectiles.length, 0);
});

test("the same visible boss head aim keeps weak-point damage across projectile speeds and tick boundaries", () => {
  const results = [30, 95, 180].map(speed => {
    const s = new Simulation({ modeId: "deathmatch", map: arena, content: {
      weapons: { rifle: { ...weapons.rifle, automatic: false, spread: 0, speed, pvpDamage: 20 } },
      enemies: { doodler: { ...enemies.doodler, speed: 0, damage: 0 } },
    } });
    s.addPlayer("a", "射手", "assault", ["rifle"], "blue", { x: 0, y: 0, z: 8 });
    const id = s.addEnemy("doodler", { x: 0, y: 0, z: 0 })!;
    s.input("a", { ...neutralInput(), seq: 1, primary: true, pitch: -Math.atan2(1.52 * 1.9 - 1.62, 8) });
    s.step();
    assert.equal(actor(s.getSnapshot(), id).hp, 3600, "weak-point classification must not make a remote immediate hit");
    s.input("a", { ...neutralInput(), seq: 2 }); s.advance(.4);
    return 3600 - actor(s.getSnapshot(), id).hp;
  });
  assert.deepEqual(results, [30, 30, 30]);
});

test("only ink that actually arrives by the turf deadline changes the final score", () => {
  const result = (fireAt: number) => {
    const s = new Simulation({ modeId: "turf", map: arena, content: { weapons: {
      rifle: { ...weapons.rifle, speed: 10, spread: 0, automatic: false },
    } } });
    s.addPlayer("a", "涂地", "assault", ["rifle"], "blue", { x: 0, y: 0, z: 0 });
    s.advance(fireAt);
    s.input("a", { ...neutralInput(), seq: 1, primary: true, pitch: 1.3 });
    s.advance(240 - fireAt);
    return s.getSnapshot();
  };
  assert.equal(result(239.9).winner, null, "unarrived bullets do not backdate floor paint at time-up");
  assert.equal(result(239.8).winner, "blue", "a collision before the deadline counts normally");
});
