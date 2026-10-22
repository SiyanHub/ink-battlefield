import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { maps, enemies, weapons } from "../src/content";
import { neutralInput, type ClassId, type GameSnapshot } from "../src/shared/contracts";

const base = maps.construction;
const arena = {
  ...base,
  boxes: [base.boxes.find(box => box.id === "ground")!],
  surfaces: [base.surfaces.find(surface => surface.id === "ground:top")!],
  spawns: [{ x: 0, y: 0, z: 0 }],
  enemySpawns: [{ x: 0, y: 0, z: -5 }],
};
const harmless = Object.fromEntries(Object.entries(enemies).map(([id, enemy]) => [id, { ...enemy, speed: 0, damage: 0 }]));
function player(snapshot: GameSnapshot) { return snapshot.actors.find(actor => actor.id === "p")!; }
function aimAt(sim: Simulation, seq: number, targetId: string, extra: Partial<ReturnType<typeof neutralInput>> = {}) {
  const snapshot = sim.getSnapshot(), self = player(snapshot), target = snapshot.actors.find(actor => actor.id === targetId)!;
  sim.input("p", { ...neutralInput(), seq,
    yaw: Math.atan2(-(target.pos.x - self.pos.x), -(target.pos.z - self.pos.z)),
    pitch: Math.atan2(self.pos.y + 1.62 - (target.pos.y + 1), Math.hypot(target.pos.x - self.pos.x, target.pos.z - self.pos.z)),
    ...extra });
}
function completeOneEncounter(classId: ClassId, seed: number) {
  const sim = new Simulation({ modeId: "solo", map: arena, seed,
    campaign: { completed: 0, upgrades: [], groups: 1, duration: 2 },
    content: { enemies: Object.fromEntries(Object.entries(harmless).map(([id, enemy]) => [id, { ...enemy, hp: 1 }])) } });
  sim.addPlayer("p", "玩家", classId, [], "player", arena.spawns[0]);
  for (let tick = 0; tick < 360 && sim.getSnapshot().phase === "playing"; tick++) {
    const target = sim.getSnapshot().actors.find(actor => actor.kind === "enemy" && actor.alive);
    if (target) aimAt(sim, tick, target.id, { primary: tick % 2 === 0 });
    sim.step();
  }
  assert.equal(sim.getSnapshot().phase, "upgrade", "real shooting must finish the encounter");
  return sim;
}

test("artist encounters never offer growth with no compatible profession weapon", () => {
  for (let seed = 1; seed <= 24; seed++) {
    const sim = completeOneEncounter("artist", seed);
    const choices = sim.getSnapshot().campaign!.choices;
    assert.equal(choices.length, 3);
    assert.ok(!choices.includes("pierce") && !choices.includes("ricochet"), `seed ${seed}: ${choices}`);
  }
});

test("available piercing growth increases actual rifle hits after selection and continuation", () => {
  let acquired: string[] | undefined;
  for (let seed = 1; seed <= 24 && !acquired; seed++) {
    const sim = completeOneEncounter("assault", seed);
    if (sim.getSnapshot().campaign!.choices.includes("pierce")) {
      sim.command("p", { type: "upgrade", upgradeId: "pierce" });
      assert.equal(sim.canContinue(), true);
      acquired = player(sim.getSnapshot()).upgrades;
    }
  }
  assert.ok(acquired?.includes("pierce"), "compatible growth must remain obtainable");
  const sim = new Simulation({ modeId: "solo", map: arena, seed: 4,
    campaign: { completed: 0, upgrades: acquired!, groups: 12 },
    content: { enemies: harmless, weapons: { rifle: { ...weapons.rifle, spread: 0 } } } });
  sim.addPlayer("p", "玩家", "assault", ["rifle"], "player", arena.spawns[0]);
  const first = sim.addEnemy("grunt", { x: 0, y: 0, z: -4 })!;
  const second = sim.addEnemy("grunt", { x: 0, y: 0, z: -7 })!;
  sim.input("p", { ...neutralInput(), seq: 1, primary: true });
  sim.step();
  sim.input("p", { ...neutralInput(), seq: 2 });
  sim.advance(.1);
  const hits = sim.takeFrame().events.filter(event => event.type === "hit" && event.actorId === "p");
  assert.deepEqual(hits.map(event => event.targetId), [first, second]);
  assert.ok(sim.getSnapshot().actors.find(actor => actor.id === second)!.hp < enemies.grunt.hp);
});

test("boss encounters expose health progress without a fictitious time limit", () => {
  for (const completed of [2, 5, 8]) {
    const sim = new Simulation({ modeId: "solo", map: arena, seed: 1,
      campaign: { completed, upgrades: [] }, content: { enemies: harmless } });
    sim.addPlayer("p", "玩家", "assault", [], "player", arena.spawns[0]);
    assert.equal(sim.getSnapshot().remaining, 0);
    sim.advance(5);
    assert.equal(sim.getSnapshot().remaining, 0);
    assert.ok(sim.getSnapshot().objective.target >= 3600);
  }
});

test("clear progress counts defeated enemies rather than spawned waves", () => {
  const sim = new Simulation({ modeId: "solo", map: arena, seed: 1,
    campaign: { completed: 0, upgrades: [], groups: 1 }, content: { enemies: harmless } });
  sim.addPlayer("p", "玩家", "scout", ["sniper"], "player", arena.spawns[0]);
  sim.advance(.7);
  let snapshot = sim.getSnapshot();
  assert.equal(snapshot.objective.progress, 0);
  assert.equal(snapshot.objective.target, 2);
  assert.match(snapshot.objective.description, /剩余纸兵 2/);
  const target = snapshot.actors.find(actor => actor.kind === "enemy" && actor.alive)!;
  aimAt(sim, 1, target.id, { primary: true });
  sim.step();
  sim.advance(.1);
  snapshot = sim.getSnapshot();
  assert.equal(snapshot.objective.progress, 1);
  assert.match(snapshot.objective.description, /剩余纸兵 1/);
  assert.equal(snapshot.phase, "playing");
});

test("paint objectives explain both required coverage and remaining enemies", () => {
  const sim = new Simulation({ modeId: "solo", map: arena, seed: 1000,
    campaign: { completed: 1, upgrades: [], groups: 1 }, content: { enemies: harmless } });
  sim.addPlayer("p", "玩家", "artist", [], "player", arena.spawns[0]);
  sim.advance(.7);
  const snapshot = sim.getSnapshot();
  assert.equal(snapshot.campaign?.objectiveKind, "paint");
  assert.match(snapshot.objective.description, /覆盖.*65%/);
  assert.match(snapshot.objective.description, /剩余纸兵 2/);
  assert.equal(snapshot.objective.target, 65);
});

function defeatCurrentEnemies(sim: Simulation, startSeq = 1) {
  let seq = startSeq;
  for (let tick = 0; tick < 300; tick++) {
    const target = sim.getSnapshot().actors.find(actor => actor.kind === "enemy" && actor.alive);
    if (!target) return seq;
    aimAt(sim, seq++, target.id, { primary: tick % 2 === 0 });
    sim.step();
  }
  assert.fail("expected live targets to be defeated by real shots");
}

test("a cleared wave in normal clear encounters advances after a short breather", () => {
  const sim = new Simulation({ modeId: "solo", map: arena, seed: 1,
    campaign: { completed: 0, upgrades: [] },
    content: { enemies: harmless, weapons: { rifle: { ...weapons.rifle, damage: 1000, spread: 0 } } } });
  sim.addPlayer("p", "玩家", "assault", ["rifle"], "player", arena.spawns[0]);
  sim.advance(.7);
  const seq = defeatCurrentEnemies(sim);
  sim.input("p", { ...neutralInput(), seq });
  sim.advance(3);
  assert.ok(sim.getSnapshot().actors.some(actor => actor.kind === "enemy" && actor.alive));
  assert.ok(sim.getSnapshot().time < 6, "quick clears need not wait for the old 12-second wave timer");
});

test("defense and explicitly configured wave schedules retain their timing", () => {
  for (const completed of [0, 1]) {
    const sim = new Simulation({ modeId: "solo", map: arena, seed: 1,
      campaign: { completed, upgrades: [], duration: 12, groups: 2 },
      content: { enemies: harmless, weapons: { rifle: { ...weapons.rifle, damage: 1000, spread: 0 } } } });
    sim.addPlayer("p", "玩家", "assault", ["rifle"], "player", arena.spawns[0]);
    sim.advance(.7);
    if (completed === 1) assert.equal(sim.getSnapshot().campaign?.objectiveKind, "defend");
    const seq = defeatCurrentEnemies(sim);
    sim.input("p", { ...neutralInput(), seq });
    sim.advance(3);
    assert.equal(sim.getSnapshot().actors.filter(actor => actor.kind === "enemy" && actor.alive).length, 0);
    sim.advance(10);
    assert.ok(sim.getSnapshot().actors.some(actor => actor.kind === "enemy" && actor.alive));
  }
});

test("rushers telegraph a committed dash and leave a punishable recovery", () => {
  const sim = new Simulation({ modeId: "solo", map: arena, seed: 1 });
  sim.addPlayer("p", "玩家", "assault", [], "player", arena.spawns[0]);
  const id = sim.addEnemy("rusher", { x: 0, y: 0, z: -10 })!;
  let warnedAt = -1;
  for (let tick = 0; tick < 180 && warnedAt < 0; tick++) {
    sim.step();
    const frame = sim.takeFrame();
    if (frame.events.some(event => event.type === "telegraph" && event.actorId === id && event.text?.includes("冲刺")))
      warnedAt = frame.snapshot.time;
  }
  assert.ok(warnedAt >= 0, "a rusher must announce its dash before committing");
  const warningPosition = sim.getSnapshot().actors.find(actor => actor.id === id)!.pos;
  sim.advance(.4);
  const windupPosition = sim.getSnapshot().actors.find(actor => actor.id === id)!.pos;
  assert.ok(Math.hypot(windupPosition.x - warningPosition.x, windupPosition.z - warningPosition.z) < .3);
  let maxSpeed = 0, damageEvents = 0;
  for (let tick = 0; tick < 50; tick++) {
    sim.step();
    const frame = sim.takeFrame(), enemy = frame.snapshot.actors.find(actor => actor.id === id)!;
    maxSpeed = Math.max(maxSpeed, Math.hypot(enemy.vel.x, enemy.vel.z));
    damageEvents += frame.events.filter(event => event.type === "hit" && event.actorId === id && event.targetId === "p").length;
  }
  assert.ok(maxSpeed >= 10, "dash speed must be distinguishable from normal running");
  assert.equal(damageEvents, 1, "one committed dash may damage the player only once");
  const recoveryStart = sim.getSnapshot().actors.find(actor => actor.id === id)!.pos;
  sim.advance(.3);
  const recoveryEnd = sim.getSnapshot().actors.find(actor => actor.id === id)!.pos;
  assert.ok(Math.hypot(recoveryEnd.x - recoveryStart.x, recoveryEnd.z - recoveryStart.z) < .12);
});

test("marksmen step back when the player crowds their firing position", () => {
  const sim = new Simulation({ modeId: "solo", map: arena, seed: 1 });
  sim.addPlayer("p", "玩家", "assault", [], "player", arena.spawns[0]);
  const id = sim.addEnemy("marksman", { x: 0, y: 0, z: -3 })!;
  sim.advance(.8);
  assert.ok(sim.getSnapshot().actors.find(actor => actor.id === id)!.pos.z < -4);
});

test("painters contest the mission zone while distant players remain outside immediate danger", () => {
  const map = { ...arena, objectives: [{ ...arena.objectives[0], center: { x: 10, y: 0, z: 0 }, radius: 3 }] };
  const sim = new Simulation({ modeId: "solo", map, seed: 1 });
  sim.addPlayer("p", "玩家", "assault", [], "player", { x: -10, y: 0, z: 0 });
  const id = sim.addEnemy("painter", { x: 0, y: 0, z: 0 })!;
  sim.advance(.8);
  assert.ok(sim.getSnapshot().actors.find(actor => actor.id === id)!.pos.x > 1);
  sim.advance(4);
  assert.ok(sim.getSnapshot().paint.surfaces.some(surface => surface.cells.some(([, , owner]) => owner === "enemy")));
});

test("the origami dive announces its locked rooftop landing surface", () => {
  const sim = new Simulation({ modeId: "solo", mapId: "street", seed: 1 });
  sim.addPlayer("p", "玩家", "assault", [], "player", { x: -13, y: 4.2, z: -16 });
  const id = sim.addEnemy("origami", { x: -13, y: 4.2, z: -14 })!;
  let landing: { x: number; y: number; z: number } | undefined;
  for (let tick = 0; tick < 180 && !landing; tick++) {
    sim.step();
    landing = sim.takeFrame().events.find(event => event.actorId === id && event.type === "telegraph" && event.text?.includes("俯冲"))?.pos;
  }
  assert.ok(landing, "the boss emits its attack warning");
  assert.ok(Math.abs(landing.y - 4.2) < .001, `warning should lie on the actual roof, got ${landing.y}`);
  for (let tick = 0; tick < 90; tick++) {
    sim.step();
    const frame = sim.takeFrame();
    if (frame.events.some(event => event.type === "skill" && event.actorId === id)) {
      const actor = frame.snapshot.actors.find(enemy => enemy.id === id)!;
      assert.ok(Math.hypot(actor.pos.x - landing.x, actor.pos.z - landing.z) < .01);
      return;
    }
  }
  assert.fail("the warned dive must resolve");
});
