import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalSession } from "../src/session/local";
import { ProfileStore } from "../src/profile/store";
test("new local session equips an advanced class weapon, rejects other classes, and supports pause and disposal", () => {
  const store = new ProfileStore();
  const session = createLocalSession({
    classId: "heavy",
    weapons: ["grenade", "sniper"],
    profileStore: store,
    autoStart: false,
  });
  assert.equal(session.getSnapshot().actors[0].weaponId, "grenade");
  assert.ok(!session.getSnapshot().actors[0].weapons.includes("sniper"));
  session.advance(0.2);
  const time = session.getSnapshot().time;
  session.command({ type: "pause" });
  session.advance(1);
  assert.equal(session.getSnapshot().time, time);
  session.command({ type: "resume" });
  session.advance(0.2);
  assert.ok(session.getSnapshot().time > time);
  let frames = 0;
  session.subscribe(() => frames++);
  session.dispose();
  session.advance(1);
  assert.equal(frames, 1);
});
test("resumed run records kills earned before its checkpoint", () => {
  const store = new ProfileStore();
  const session = createLocalSession({
    classId: "heavy",
    profileStore: store,
    autoStart: false,
    checkpoint: {
      classId: "heavy",
      seed: 42,
      completed: 0,
      upgrades: [],
      weapons: ["shotgun", "hammer"],
      totalKills: 17,
    },
  });
  session.advance(300);
  assert.equal(session.getSnapshot().phase, "defeat");
  assert.equal(store.load().stats.kills, 17);
  session.dispose();
});
