import { test } from "node:test";
import assert from "node:assert/strict";
import { createPracticeSession, PracticeSession } from "../src/session/practice";
import { neutralInput } from "../src/shared/contracts";
import { Simulation } from "../src/core/simulation";
import { maps } from "../src/content";
import { surfacesForBox } from "../src/content/maps";

test("practice guide counts a successful skill immediately, preserves early progress and stays frozen while paused", () => {
  const session = new PracticeSession({ classId: "scout", autoStart: false });
  try {
    assert.equal(session.getSnapshot().objective.target, 3);
    assert.equal(session.getSnapshot().objective.progress, 0);
    assert.match(session.getSnapshot().objective.description, /E/);
    session.command({ type: "pause" });
    session.submitInput({ ...neutralInput(), seq: 1, skill: true });
    session.advance(1);
    assert.equal(session.getSnapshot().objective.progress, 0, "a queued key press is not a successful skill");
    session.command({ type: "resume" });
    session.advance(1 / 60);
    assert.ok(session.getSnapshot().actors.find((a) => a.id === session.playerId)!.skillCooldown > 0);
    assert.equal(session.getSnapshot().objective.progress, 1);
    session.advance(20);
    assert.equal(session.getSnapshot().objective.progress, 1, "early skill completion survives cooldown expiry");
    assert.match(session.getSnapshot().objective.description, /纸靶/);
    assert.match(session.getSnapshot().objective.description, /1%/);
  } finally { session.dispose(); }
});

test("practice accepts ground painting before three real target kills and keeps playing after all three milestones", () => {
  const ground = { id: "ground", center: { x: 0, y: -0.5, z: 0 }, size: { x: 10, y: 1, z: 10 }, scoring: true };
  const simulation = new Simulation({
    modeId: "practice", seed: 17,
    map: { ...maps.construction, boxes: [ground], surfaces: surfacesForBox(ground) },
  });
  simulation.addPlayer("p", "试笔者", "assault", ["rifle"], "p", { x: 0, y: 0, z: 4 });
  simulation.addEnemy("grunt", { x: 0, y: 0, z: -1 });
  simulation.input("p", { ...neutralInput(), seq: 1, primary: true, pitch: 1.2 });
  simulation.step();
  assert.equal(simulation.getSnapshot().objective.progress, 1, "a real floor shot covers over 1% of this small scoring floor");
  assert.doesNotMatch(simulation.getSnapshot().objective.description, /向地面/);
  for (let kill = 0; kill < 3; kill++) {
    simulation.input("p", { ...neutralInput(), seq: 2 + kill * 2, primary: true });
    simulation.advance(1.1);
    assert.equal(simulation.getSnapshot().actors.find((a) => a.id === "p")!.kills, kill + 1);
    assert.equal(simulation.getSnapshot().objective.progress, kill === 2 ? 2 : 1);
    simulation.input("p", { ...neutralInput(), seq: 3 + kill * 2 });
    simulation.advance(5);
  }
  simulation.input("p", { ...neutralInput(), seq: 8, skill: true });
  simulation.step();
  assert.equal(simulation.getSnapshot().objective.progress, 3);
  assert.match(simulation.getSnapshot().objective.description, /继续/);
  simulation.advance(30);
  assert.equal(simulation.getSnapshot().phase, "playing");
  assert.equal(simulation.getSnapshot().winner, null);
  assert.deepEqual(simulation.getSnapshot().scores, {});
  assert.equal(simulation.getSnapshot().campaign, undefined);
});

test("practice guide resets with the paused field or loadout and never shares progress between sessions", () => {
  const first = new PracticeSession({ classId: "scout", autoStart: false });
  const second = new PracticeSession({ classId: "scout", autoStart: false });
  try {
    first.submitInput({ ...neutralInput(), seq: 1, skill: true });
    first.advance(1 / 60);
    second.advance(1 / 60);
    assert.equal(first.getSnapshot().objective.progress, 1);
    assert.equal(second.getSnapshot().objective.progress, 0);
    first.command({ type: "pause" });
    first.command({ type: "continue" });
    first.advance(10);
    assert.equal(first.getSnapshot().phase, "paused");
    assert.equal(first.getSnapshot().objective.progress, 0);
    first.command({ type: "resume" });
    first.submitInput({ ...neutralInput(), seq: 1, skill: true });
    first.advance(1 / 60);
    assert.equal(first.getSnapshot().objective.progress, 1);
    first.command({ type: "loadout", weapons: ["sniper"] });
    assert.equal(first.getSnapshot().objective.progress, 0);
    assert.equal(first.getSnapshot().objective.target, 3);
    assert.equal(second.getSnapshot().objective.progress, 0);
  } finally { first.dispose(); second.dispose(); }
});

test("painting a wall does not satisfy practice scoring-floor coverage", () => {
  const ground = { id: "ground", center: { x: 0, y: -0.5, z: 0 }, size: { x: 10, y: 1, z: 10 }, scoring: true };
  const wall = { id: "wall", center: { x: 0, y: 2, z: -4 }, size: { x: 10, y: 4, z: 1 }, scoring: false };
  const simulation = new Simulation({
    modeId: "practice", seed: 17,
    map: { ...maps.construction, boxes: [ground, wall], surfaces: [...surfacesForBox(ground), ...surfacesForBox(wall)] },
  });
  simulation.addPlayer("p", "试笔者", "assault", ["rifle"], "p", { x: 0, y: 0, z: 4 });
  simulation.input("p", { ...neutralInput(), seq: 1, primary: true });
  simulation.advance(1);
  assert.ok(simulation.getSnapshot().paint.surfaces.some((surface) => surface.id.startsWith("wall") && surface.cells.length));
  assert.equal(simulation.getSnapshot().objective.progress, 0);
});

test("practice opens every class weapon in an isolated, pausable session with static targets", () => {
  const session = createPracticeSession({
    classId: "heavy", weapons: ["grenade", "sniper"], autoStart: false,
  });
  try {
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.modeId, "practice");
    assert.equal(snapshot.campaign, undefined);
    assert.deepEqual(snapshot.scores, {});
    const player = snapshot.actors.find((a) => a.id === session.playerId)!;
    assert.equal(player.weaponId, "grenade");
    assert.ok(!player.weapons.includes("sniper"));
    assert.ok(snapshot.actors.filter((a) => a.kind === "enemy").length >= 3);
    assert.ok(snapshot.actors.filter((a) => a.kind === "enemy").every((a) => a.yaw === Math.PI), "paper targets face the player spawn side");
    session.command({ type: "pause" });
    assert.equal(session.getSnapshot().phase, "paused");
    session.command({ type: "resume" });
    assert.equal(session.getSnapshot().phase, "playing");
  } finally { session.dispose(); }
});

test("practice shots spend real ammo, kill a stationary target, paint the ground and restore it after five seconds", () => {
  const session = new PracticeSession({ classId: "assault", weapons: ["rifle"], autoStart: false });
  try {
    const target = session.getSnapshot().actors.find((a) => a.enemyId === "grunt")!;
    session.advance(20);
    assert.deepEqual(session.getSnapshot().actors.find((a) => a.id === target.id)!.pos, target.pos);
    session.submitInput({ ...neutralInput(), seq: 1, primary: true });
    session.advance(1 / 60);
    assert.equal(session.getSnapshot().actors.find((a) => a.id === session.playerId)!.ammo.rifle.clip, 29);
    assert.ok(session.getSnapshot().actors.find((a) => a.id === target.id)!.hp < target.hp);
    session.advance(1);
    assert.equal(session.getSnapshot().actors.find((a) => a.id === target.id)!.alive, false);
    assert.ok(session.getSnapshot().paint.surfaces.some((s) => s.cells.length > 0));
    session.submitInput({ ...neutralInput(), seq: 2 });
    session.advance(5);
    const replacement = session.getSnapshot().actors.find((a) => a.enemyId === "grunt" && a.alive);
    assert.ok(replacement);
    assert.equal(replacement.hp, 90);
    assert.deepEqual(replacement.pos, target.pos);
    assert.equal(replacement.yaw, Math.PI, "respawned paper target still faces the player spawn side");
    assert.equal(session.getSnapshot().phase, "playing");
    assert.deepEqual(session.getSnapshot().scores, {});
  } finally { session.dispose(); }
});

test("resetting a paused practice session replenishes real ammo and clears ink without resuming", () => {
  const session = new PracticeSession({ classId: "assault", weapons: ["rifle"], autoStart: false });
  try {
    session.submitInput({ ...neutralInput(), seq: 1, primary: true, pitch: 1.2 });
    session.advance(1);
    assert.ok(session.getSnapshot().paint.surfaces.some((s) => s.cells.length > 0));
    session.command({ type: "pause" });
    session.command({ type: "continue" });
    const reset = session.getSnapshot();
    assert.equal(reset.phase, "paused");
    assert.equal(reset.time, 0);
    assert.equal(reset.actors.find((a) => a.id === session.playerId)!.ammo.rifle.clip, 30);
    assert.ok(reset.paint.surfaces.every((s) => s.cells.length === 0));
    session.advance(10);
    assert.equal(session.getSnapshot().time, 0);
  } finally { session.dispose(); }
});

test("practice can change its unlocked class loadout and ignores commands after disposal", () => {
  const session = new PracticeSession({ classId: "heavy", weapons: ["shotgun"], autoStart: false });
  session.command({ type: "pause" });
  session.command({ type: "loadout", weapons: ["grenade", "sniper"] });
  const equipped = session.getSnapshot().actors.find((a) => a.id === session.playerId)!;
  assert.equal(equipped.weaponId, "grenade");
  assert.ok(!equipped.weapons.includes("sniper"));
  assert.equal(session.getSnapshot().phase, "paused");
  let frames = 0;
  session.subscribe(() => frames++);
  session.dispose();
  const last = session.getSnapshot();
  session.command({ type: "continue" });
  session.submitInput({ ...neutralInput(), seq: 1, primary: true });
  session.advance(2);
  assert.strictEqual(session.getSnapshot(), last);
  assert.equal(frames, 1);
});
