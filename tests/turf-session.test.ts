import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { neutralInput } from "../src/shared/contracts";
import { TurfSession } from "../src/session/turf";

test("an explicit local turf simulation pauses while ordinary turf remains live", () => {
  for (const allowPause of [false, true]) {
    const sim = new Simulation({ modeId: "turf", mapId: "construction", teamMode: true, allowPause });
    sim.addPlayer("p", "玩家", "artist", [], "blue");
    sim.command("p", { type: "pause" });
    assert.equal(sim.getSnapshot().phase, allowPause ? "paused" : "playing");
    sim.advance(2);
    assert.equal(sim.getSnapshot().time, allowPause ? 0 : 2);
    sim.command("p", { type: "resume" });
    sim.advance(1);
    assert.equal(sim.getSnapshot().phase, "playing");
    assert.equal(sim.getSnapshot().time, allowPause ? 1 : 3);
  }
});

test("a local controller hook supplies real inputs only during active simulation", () => {
  let calls = 0;
  const sim = new Simulation({ modeId: "turf", mapId: "construction", allowPause: true,
    beforeStep: simulation => { calls++; simulation.input("p", { ...neutralInput(), seq: calls, primary: true, pitch: 1.3 }); } });
  sim.addPlayer("p", "玩家", "artist", ["pencil"], "blue");
  sim.advance(.5);
  assert.equal(calls, 30);
  assert.ok(sim.takeFrame().events.some(event => event.type === "shot" && event.actorId === "p"));
  sim.command("p", { type: "pause" }); sim.advance(2);
  assert.equal(calls, 30);
});

test("offline turf starts two real player teams without campaign state", () => {
  const session = new TurfSession({ classId: "assault", autoStart: false, seed: 12 });
  try {
    const snapshot = session.getSnapshot();
    assert.equal(session.playerId, "turf-player");
    assert.equal(snapshot.modeId, "turf");
    assert.equal(snapshot.remaining, 240);
    assert.equal(snapshot.campaign, undefined);
    assert.equal(snapshot.actors.length, 4);
    assert.ok(snapshot.actors.every(actor => actor.kind === "player"));
    assert.equal(snapshot.actors.filter(actor => actor.teamId === "blue").length, 2);
    assert.equal(snapshot.actors.filter(actor => actor.teamId === "red").length, 2);
  } finally { session.dispose(); }
});

for (const mapId of ["construction", "street", "fortress"])
  test(`offline bots move and paint both teams through real weapon inputs on ${mapId}`, () => {
    const session = new TurfSession({ classId: "artist", mapId, autoStart: false, seed: 9 });
    try {
      const initial = session.getSnapshot(), moved = new Set<string>(), shooters = new Set<string>();
      session.subscribe(frame => {
        for (const event of frame.events) if (event.type === "shot" && event.actorId !== session.playerId) shooters.add(event.actorId!);
        for (const actor of frame.snapshot.actors) {
          if (actor.id === session.playerId) continue;
          const start = initial.actors.find(other => other.id === actor.id)!;
          if (Math.hypot(actor.pos.x - start.pos.x, actor.pos.z - start.pos.z) > 8) moved.add(actor.id);
        }
      });
      for (let step = 0; step < 15; step++) session.advance(2);
      const snapshot = session.getSnapshot();
      assert.equal(snapshot.mapId, mapId);
      assert.ok((snapshot.scores.blue ?? 0) > 1, `blue floor coverage ${snapshot.scores.blue}`);
      assert.ok((snapshot.scores.red ?? 0) > 1, `red floor coverage ${snapshot.scores.red}`);
      assert.equal(shooters.size, 3, "all computer players must execute actual weapon actions");
      assert.equal(moved.size, 3, "computers must leave spawn and contest the map");
      assert.ok(snapshot.actors.every(actor => actor.pos.y >= -.5));
    } finally { session.dispose(); }
  });

test("offline turf freezes all players and scoring while paused and restarts with a clean field", () => {
  const session = new TurfSession({ classId: "artist", autoStart: false, seed: 4 });
  let restarted: TurfSession | undefined;
  try {
    session.advance(10); session.command({ type: "pause" });
    const paused = session.getSnapshot();
    session.advance(20);
    assert.deepEqual(session.getSnapshot(), paused);
    assert.equal(paused.phase, "paused");
    session.command({ type: "resume" }); session.advance(1);
    assert.equal(session.getSnapshot().time, paused.time + 1);
    restarted = new TurfSession({ classId: "artist", autoStart: false, seed: 4 });
    assert.equal(restarted.getSnapshot().remaining, 240);
    assert.ok(restarted.getSnapshot().paint.surfaces.every(surface => surface.cells.length === 0));
    session.dispose(); const ended = session.getSnapshot(); session.advance(10);
    assert.deepEqual(session.getSnapshot(), ended);
  } finally { session.dispose(); restarted?.dispose(); }
});

test("offline turf resolves at four minutes from floor coverage and never touches browser saves", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let storageCalls = 0;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem() { storageCalls++; return null; }, setItem() { storageCalls++; }, removeItem() { storageCalls++; },
  } });
  const session = new TurfSession({ classId: "artist", autoStart: false, seed: 4 });
  try {
    session.advance(239); assert.equal(session.getSnapshot().phase, "playing");
    session.advance(1);
    const result = session.getSnapshot();
    assert.equal(result.phase, "victory"); assert.equal(result.remaining, 0);
    const blue = result.scores.blue ?? 0, red = result.scores.red ?? 0;
    assert.ok(blue > 0 && red > 0);
    assert.equal(result.winner, Math.abs(blue - red) < .00001 ? null : blue > red ? "blue" : "red");
    session.advance(5); assert.deepEqual(session.getSnapshot(), result);
    assert.equal(storageCalls, 0);
  } finally {
    session.dispose();
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("offline deaths keep the match running and accept equipment changes for automatic respawn", () => {
  const session = new TurfSession({ classId: "assault", autoStart: false, seed: 4 });
  try {
    const initial = session.getSnapshot().actors.find(actor => actor.id === session.playerId)!;
    session.simulation.addPlayer("test-opponent", "对手", "scout", ["sniper"], "red",
      { x: initial.pos.x, y: initial.pos.y, z: initial.pos.z - 4 });
    session.advance(2);
    for (let seq = 1; seq <= 80 && session.getSnapshot().actors.find(actor => actor.id === session.playerId)!.alive; seq++) {
      session.simulation.input("test-opponent", { ...neutralInput(), seq, yaw: Math.PI, primary: seq % 2 === 1 });
      session.advance(.1);
    }
    const dead = session.getSnapshot().actors.find(actor => actor.id === session.playerId)!;
    assert.equal(dead.alive, false, "real hostile shots must kill the local player");
    assert.equal(session.getSnapshot().phase, "playing");
    session.command({ type: "respawn", classId: "heavy", weapons: ["lmg", "grenade"] });
    session.advance(5.1);
    const revived = session.getSnapshot().actors.find(actor => actor.id === session.playerId)!;
    assert.equal(revived.alive, true); assert.equal(revived.classId, "heavy");
    assert.equal(revived.teamId, "blue"); assert.equal(revived.deaths, 1);
    assert.ok(revived.weapons.includes("lmg"));
  } finally { session.dispose(); }
});
