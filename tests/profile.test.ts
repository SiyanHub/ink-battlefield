import { test } from "node:test";
import assert from "node:assert/strict";
import { ProfileStore } from "../src/profile/store";
const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
};
test("all class weapons are available immediately for new and existing profiles without fake progress", () => {
  const storage = memory();
  const store = new ProfileStore(storage);
  const expected = {
    assault: ["rifle", "smg", "carbine", "dual", "scatter", "katana"],
    heavy: ["shotgun", "lmg", "grenade", "rocket", "minigun", "hammer"],
    scout: ["revolver", "sniper", "bow", "crossbow", "nailgun", "compass"],
    artist: ["pencil", "brush", "pen", "bucket", "bubble", "roller"],
  } as const;
  for (const id of ["assault", "heavy", "scout", "artist"] as const)
    assert.deepEqual(store.unlockedWeapons(id), [...expected[id]]);
  const saved = store.load();
  saved.progress.heavy = 2;
  store.save(saved);
  const reloaded = new ProfileStore(storage);
  for (const id of ["assault", "heavy", "scout", "artist"] as const)
    assert.deepEqual(reloaded.unlockedWeapons(id), [...expected[id]]);
  assert.deepEqual(reloaded.load().progress, {assault:0, heavy:2, scout:0, artist:0});
  assert.deepEqual(reloaded.load().stats, {runs:0, wins:0, kills:0});
});
test("encounter statistics persist while death clears only the current run", () => {
  const storage = memory(),
    p = new ProfileStore(storage);
  assert.deepEqual(p.unlockedWeapons("heavy"), ["shotgun", "lmg", "grenade", "rocket", "minigun", "hammer"]);
  for (let i = 0; i < 3; i++) p.recordEncounter("heavy");
  assert.deepEqual(new ProfileStore(storage).unlockedWeapons("heavy"), [
    "shotgun",
    "lmg",
    "grenade",
    "rocket",
    "minigun",
    "hammer",
  ]);
  const profile = p.load();
  profile.checkpoint = {
    classId: "heavy",
    seed: 42,
    completed: 3,
    upgrades: ["damage"],
    weapons: ["shotgun", "lmg"],
  };
  p.save(profile);
  p.recordRun(false, 8);
  const next = new ProfileStore(storage).load();
  assert.equal(next.checkpoint, null);
  assert.equal(next.progress.heavy, 3);
  assert.equal(next.stats.kills, 8);
  assert.equal(next.stats.runs, 1);
});
test("corrupt saves keep a recovery copy and expose a usable profile", () => {
  const storage = memory();
  storage.setItem("ink-battlefield.profile.v1", "{broken");
  const p = new ProfileStore(storage);
  assert.equal(p.load().version, 1);
  assert.equal(storage.getItem("ink-battlefield.profile.backup"), "{broken");
  assert.ok(p.recoveryNotice);
});
test("checkpoint kills survive reload and old saves default to zero", () => {
  const storage = memory();
  const store = new ProfileStore(storage);
  store.checkpoint({
    classId: "heavy",
    seed: 42,
    completed: 1,
    upgrades: [],
    weapons: ["shotgun", "hammer"],
    totalKills: 17,
  });
  assert.equal(new ProfileStore(storage).load().checkpoint?.totalKills, 17);
  const old = store.load();
  old.checkpoint = {
    classId: "heavy",
    seed: 42,
    completed: 1,
    upgrades: [],
    weapons: ["shotgun", "hammer"],
  };
  store.save(old);
  assert.equal(new ProfileStore(storage).load().checkpoint?.totalKills, 0);
});
