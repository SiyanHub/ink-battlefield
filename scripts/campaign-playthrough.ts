import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LocalSession } from "../src/session/local";
import { ProfileStore } from "../src/profile/store";
import { maps, weapons, classes } from "../src/content";
import { World } from "../src/core/world";
import { Navigation } from "../src/core/navigation";
import { actorGeometry } from "../src/shared/actor-geometry";
import { neutralInput, type ClassId, type Vec3 } from "../src/shared/contracts";

// QA controller only: never imported by the game or multiplayer server.
// Real maps, default enemies/damage and public LocalSession inputs only.
const selected = (process.argv[2] ?? "assault") as ClassId;
const seed=Number(process.argv.find(a=>a.startsWith('--seed='))?.slice(7)??7421);
assert.ok(Number.isSafeInteger(seed));
if (!classes[selected]) throw Error("Unknown class");
const store = new ProfileStore();
const unlocked = process.argv.includes("--unlocked");
if (unlocked) for (let i = 0; i < 6; i++) store.recordEncounter(selected);
let session = new LocalSession({
  classId: selected,
  profileStore: store,
  autoStart: false,
  checkpoint: {
    classId: selected,
    seed,
    completed: 0,
    upgrades: [],
    weapons: unlocked
      ? [classes[selected].weapons[1], classes[selected].weapons[2]]
      : [classes[selected].weapons[0]],
  },
});
let world = new World(maps.construction),
  nav = new Navigation(world),
  mapId = "construction";
const restoreBetweenEncounters = process.argv.includes("--resume");
let checkpointKills = 0;
let seq = 0,
  totalSeconds = 0,
  lastStage = 0,
  fireAge = 0,
  stuckTime = 0;
let lastPosition: Vec3 = { ...session.getSnapshot().actors[0].pos };
const stages: object[] = [],
  priority = [
    "damage",
    "supply",
    "health",
    "recycle",
    "weakpoint",
    "magazine",
    "reload",
    "speed",
  ];
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
while (totalSeconds < 2400) {
  const s = session.getSnapshot(),
    p = s.actors.find((a) => a.id === session.playerId)!;
  if (s.phase === "victory" || s.phase === "defeat") {
    stages.push({
      stage: s.campaign?.completed,
      phase: s.phase,
      hp: p.hp,
      deviceHp: s.objective.deviceHp,
      time: totalSeconds,
    });
    break;
  }
  if (s.phase === "upgrade") {
    stages.push({
      stage: s.campaign!.completed,
      phase: s.phase,
      hp: p.hp,
      deviceHp: s.objective.deviceHp,
      time: totalSeconds,
      kills: p.kills,
    });
    const choices = s.campaign!.choices,
      upgrade = priority.find((id) => choices.includes(id)) ?? choices[0];
    session.command({ type: "upgrade", upgradeId: upgrade });
    session.command({
      type: "loadout",
      weapons:
        selected === "heavy" && store.unlockedWeapons(selected).includes("lmg")
          ? ["lmg", "grenade"]
          : store.unlockedWeapons(selected),
    });
    session.command({ type: "continue" });
    checkpointKills += p.kills;
    const cp = store.load().checkpoint;
    assert.ok(cp);
    assert.equal(cp.completed, s.campaign!.completed);
    assert.equal(cp.totalKills, checkpointKills);
    if (restoreBetweenEncounters) {
      session.dispose();
      session = new LocalSession({
        classId: selected,
        profileStore: new ProfileStore(store.storage),
        autoStart: false,
        checkpoint: cp,
      });
      assert.deepEqual(session.getSnapshot().actors[0].upgrades, cp.upgrades);
    }
    lastStage = s.campaign!.completed;
    fireAge = 0;
    continue;
  }
  if (s.mapId !== mapId) {
    mapId = s.mapId;
    world = new World(maps[mapId]);
    nav = new Navigation(world);
  }
  const eye = { ...p.pos, y: p.pos.y + 1.62 };
  const alive = s.actors.filter((a) => a.kind === "enemy" && a.alive);
  const visible = alive.filter((a) =>
    world.visible(eye, { ...a.pos, y: a.pos.y + actorGeometry(a).headHeight }),
  );
  const target = (visible.length ? visible : alive).sort(
    (a, b) => distance(p.pos, a.pos) - distance(p.pos, b.pos),
  )[0];
  const input = neutralInput();
  input.seq = ++seq;
  input.yaw = p.yaw;
  input.pitch = p.pitch;
  const main = p.weapons.find(
    (id) => id && p.ammo[id] && (p.ammo[id].clip > 0 || p.ammo[id].reserve > 0),
  );
  const chosen = main ?? classes[selected].melee,
    w = weapons[chosen];
  input.slot = p.weapons.indexOf(chosen);
  let goal: Vec3 | undefined;
  if (target) {
    const d = distance(p.pos, target.pos),
      head = actorGeometry(target).headHeight;
    const lead = w.speed ? Math.min(0.4, d / w.speed) : 0;
    const aim = {
      x: target.pos.x + target.vel.x * lead,
      y: target.pos.y + head,
      z: target.pos.z + target.vel.z * lead,
    };
    const dx = aim.x - eye.x,
      dy = aim.y - eye.y,
      dz = aim.z - eye.z;
    input.yaw = Math.atan2(-dx, -dz);
    input.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    const canSee = visible.includes(target),
      reach = w.melee
        ? 2
        : chosen === "shotgun"
          ? 9
          : Math.min(20, w.range * 0.65);
    if (!canSee || d > reach)
      goal = nav.next(
        "qa-player",
        p.pos,
        { ...target.pos, y: Math.max(0, world.floor(target.pos) ?? 0) },
        totalSeconds,
      );
    else if (!w.melee) {
      // Strafe and back away while still facing the selected target.
      input.moveX = Math.sin(totalSeconds * 0.37) >= 0 ? 0.8 : -0.8;
      input.moveZ = d < (selected === "heavy" ? 8 : 6) ? -0.7 : 0;
    }
    fireAge += 0.05;
    input.primary =
      canSee &&
      (w.automatic || fireAge % (Math.max(0.15, w.interval) + 0.1) < 0.1);
    if (w.charge) input.primary = fireAge % (w.charge + 0.2) < w.charge;
    input.secondary = chosen === "sniper";
    input.skill =
      selected === "heavy"
        ? d < 10 && (!!target.telegraph || p.hp < 65)
        : selected === "scout" || d < 7;
  } else if (
    s.campaign?.objectiveKind === "paint" &&
    s.objective.progress < 65
  ) {
    const center = maps[mapId].objectives[0].center;
    const a = totalSeconds * 0.7;
    goal = {
      x: center.x + Math.cos(a) * (2.2+Math.sin(totalSeconds*.13)*1.5),
      y: center.y,
      z: center.z + Math.sin(a) * (2.2+Math.sin(totalSeconds*.13)*1.5),
    };
    input.slot = 2;
    const melee = weapons[classes[selected].melee];
    fireAge += 0.05;
    // Semiautomatic melee needs a fresh press for every stroke, just like combat.
    input.primary = melee.automatic || fireAge % (Math.max(0.15, melee.interval) + 0.1) < 0.1;
    input.pitch = 1.2;
    input.skill = selected === "artist";
  } else if (s.campaign?.objectiveKind === "defend")
    goal = maps[mapId].objectives[0].center;

  if (goal && distance(p.pos, goal) > 0.5) {
    const dx = goal.x - p.pos.x,
      dz = goal.z - p.pos.z,
      n = Math.hypot(dx, dz) || 1;
    input.moveX = (Math.cos(input.yaw) * dx - Math.sin(input.yaw) * dz) / n;
    input.moveZ = (-Math.sin(input.yaw) * dx - Math.cos(input.yaw) * dz) / n;
    input.sprint = !target;
  }
  stuckTime = distance(p.pos, lastPosition) < 0.025 ? stuckTime + 0.05 : 0;
  lastPosition = { ...p.pos };
  input.jump =
    stuckTime > 0.8 ||
    (!!target && distance(p.pos, target.pos) < 4 && seq % 30 === 0);
  if (stuckTime > 2) {
    input.moveX = Math.sin(totalSeconds) * 1;
    input.moveZ = Math.cos(totalSeconds) * 1;
  }
  const ammo = p.ammo[p.weaponId];
  input.reload = !!ammo && ammo.clip === 0 && ammo.reserve > 0;
  session.submitInput(input);
  session.advance(0.05);
  totalSeconds += 0.05;
  if (seq % 600 === 0)
    console.log(
      JSON.stringify({
        classId: selected,
        completed: lastStage,
        seconds: Math.round(totalSeconds),
        hp: p.hp,
        enemies: alive.length,
        objective: s.campaign?.objectiveKind,
      }),
    );
}
const final = session.getSnapshot();
if (final.phase === "victory" || final.phase === "defeat")
  assert.equal(
    store.load().stats.kills,
    checkpointKills +
      final.actors.find((a) => a.id === session.playerId)!.kills,
  );
const report = {
  classId: selected,
  restoreBetweenEncounters,
  unlockedAtStart: unlocked,
  seed,
  controller:
    "scripted input, aim assistance and map navigation; default content, no damage/health overrides; not human play",
  seconds: totalSeconds,
  phase: final.phase,
  completed: final.campaign?.completed,
  stages,
  profile: store.load(),
  finalActors: final.actors.map((a) => ({
    id: a.id,
    hp: a.hp,
    alive: a.alive,
    pos: a.pos,
    weaponId: a.weaponId,
    ammo: a.ammo,
  })),
};
const reportPath = process.argv.find(argument => argument.startsWith("--report="))?.slice(9) ??
  `artifacts/campaign-${selected}${unlocked ? "-unlocked" : ""}${restoreBetweenEncounters ? "-resume" : ""}${seed!==7421?'-'+seed:''}.json`;
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));
session.dispose();
console.log(
  JSON.stringify({
    phase: report.phase,
    completed: report.completed,
    seconds: report.seconds,
  }),
);
