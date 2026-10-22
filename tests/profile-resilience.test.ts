import test from "node:test";
import assert from "node:assert/strict";
import { ProfileStore, PROFILE_KEY } from "../src/profile/store";
import { GameController } from "../src/client/ui/controller";

function storageHarness() {
  const values = new Map<string, string>();
  const state = { failing: false, reads: 0 };
  return { values, state, storage: {
    getItem(key: string) { state.reads++; return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (state.failing) throw new Error("quota"); values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  } };
}

test("a runtime save failure notifies the player, retains this session and later persists recovery", () => {
  const h = storageHarness(), store = new ProfileStore(h.storage), notices: string[] = [];
  const game = new GameController(store, { notice: message => notices.push(message) });
  h.state.failing = true;
  game.change("setting:volume", .7);
  assert.ok(notices.some(message => /未能保存|未能写入/.test(message)));
  assert.equal(store.load().settings.volume, .7, "the running session retains the changed preference");
  store.checkpoint({ classId: "assault", seed: 7, completed: 2, upgrades: ["damage"], weapons: ["rifle"] });
  assert.equal(store.load().checkpoint?.completed, 2);
  h.state.failing = false;
  game.change("setting:sensitivity", 1.4);
  const restored = new ProfileStore(h.storage).load();
  assert.equal(restored.settings.volume, .7);
  assert.equal(restored.checkpoint?.completed, 2);
  assert.ok(notices.some(message => /恢复.*保存|保存已恢复/.test(message)));
});

test("a corrupt profile never claims a backup succeeded when storage refuses it", () => {
  const h = storageHarness();
  h.values.set(PROFILE_KEY, "{broken"); h.state.failing = true;
  const store = new ProfileStore(h.storage);
  assert.equal(store.load().version, 1);
  assert.doesNotMatch(store.recoveryNotice, /已保留恢复副本/);
  assert.match(store.recoveryNotice, /备份.*失败|无法备份/);
  assert.equal(h.values.get(PROFILE_KEY), "{broken", "failed backup must not remove the original");
});

test("repeated profile reads use a cached snapshot and callers cannot mutate stored state", () => {
  const h = storageHarness(), store = new ProfileStore(h.storage);
  store.load(); const reads = h.state.reads;
  for (let i = 0; i < 120; i++) store.load();
  assert.equal(h.state.reads, reads);
  const detached = store.load(); detached.settings.volume = .1;
  assert.equal(store.load().settings.volume, .5);
});

test("a second open profile can change settings without rolling back another instance's progress", () => {
  const h = storageHarness(), first = new ProfileStore(h.storage), second = new ProfileStore(h.storage);
  first.load(); second.load(); first.recordRun(true, 7);
  first.checkpoint({ classId: "assault", seed: 9, completed: 2, upgrades: [], weapons: ["rifle"] });
  second.updateSettings({ volume: .7 });
  const current = new ProfileStore(h.storage).load();
  assert.equal(current.stats.kills, 7); assert.equal(current.checkpoint?.completed, 2);
});

test("retrying after corrupt-save backup failure preserves the original before writing a replacement", () => {
  const h = storageHarness(); h.values.set(PROFILE_KEY, "{broken"); h.state.failing = true;
  const store = new ProfileStore(h.storage); store.load();
  h.state.failing = false; store.retrySave();
  assert.equal(h.values.get("ink-battlefield.profile.backup"), "{broken");
});

test("retry merges only locally changed settings and retains another window's newer progress and checkpoint", () => {
  const h = storageHarness();
  let rejectLocal = false;
  const local = new ProfileStore({ ...h.storage, setItem(key, value) {
    if (rejectLocal) throw Error("temporary write failure"); h.storage.setItem(key, value);
  } });
  const other = new ProfileStore(h.storage);
  local.load(); other.load(); rejectLocal = true;
  local.updateSettings({ volume: .7 });
  other.recordRun(true, 7);
  other.updateSettings({ sensitivity: 1.6 });
  const renamed = other.load(); renamed.name = "另一位画者"; other.save(renamed);
  other.checkpoint({ classId: "assault", seed: 9, completed: 2, upgrades: [], weapons: ["rifle"] });
  rejectLocal = false;
  assert.equal(local.retrySave(), true);
  const result = new ProfileStore(h.storage).load();
  assert.deepEqual(result.stats, { runs: 1, wins: 1, kills: 7 });
  assert.equal(result.checkpoint?.completed, 2);
  assert.equal(result.settings.volume, .7);
  assert.equal(result.settings.sensitivity, 1.6);
  assert.equal(result.name, "另一位画者");
});

test("failed local statistics merge as increments and a later retry does not count them twice", () => {
  const h = storageHarness();
  let rejectLocal = false;
  const local = new ProfileStore({ ...h.storage, setItem(key, value) {
    if (rejectLocal) throw Error("temporary write failure"); h.storage.setItem(key, value);
  } });
  const other = new ProfileStore(h.storage);
  local.recordRun(false, 10); other.load(); rejectLocal = true;
  local.recordRun(true, 3); local.recordEncounter("assault");
  other.recordRun(false, 7); other.recordEncounter("assault");
  rejectLocal = false;
  assert.equal(local.retrySave(), true);
  assert.equal(local.retrySave(), true);
  const result = new ProfileStore(h.storage).load();
  assert.deepEqual(result.stats, { runs: 3, wins: 1, kills: 20 });
  assert.equal(result.progress.assault, 2);
});

test("conflicting local checkpoints preserve the external profile before keeping this window's checkpoint", () => {
  const h = storageHarness();
  let rejectLocal = false;
  const local = new ProfileStore({ ...h.storage, setItem(key, value) {
    if (rejectLocal) throw Error("temporary write failure"); h.storage.setItem(key, value);
  } });
  const other = new ProfileStore(h.storage), notices: string[] = [];
  local.onSaveNotice(message => notices.push(message));
  local.load(); other.load(); rejectLocal = true;
  local.checkpoint({ classId: "assault", seed: 1, completed: 1, upgrades: [], weapons: ["rifle"] });
  other.checkpoint({ classId: "heavy", seed: 2, completed: 4, upgrades: [], weapons: ["shotgun"] });
  const external = h.values.get(PROFILE_KEY)!;
  rejectLocal = false;
  assert.equal(local.retrySave(), true);
  assert.equal(new ProfileStore(h.storage).load().checkpoint?.seed, 1);
  assert.ok([...h.values].some(([key, raw]) => key.startsWith("ink-battlefield.profile.conflict.") && raw === external),
    "another run's checkpoint must remain recoverable before it is replaced");
  assert.ok(notices.some(message => /冲突.*备份|备份.*检查点/.test(message)));
});

test("an unreadable latest profile is never overwritten by a cached retry", () => {
  const h = storageHarness(); let failReads = false;
  const local = new ProfileStore({ ...h.storage, getItem(key) {
    if (failReads) throw Error("read unavailable"); return h.storage.getItem(key);
  } });
  local.load();
  const other = new ProfileStore(h.storage); other.recordRun(true, 8);
  const external = h.values.get(PROFILE_KEY);
  failReads = true;
  assert.equal(local.retrySave(), false);
  assert.equal(h.values.get(PROFILE_KEY), external);
  assert.equal(local.hasUnsavedChanges, true);
});

test("a checkpoint conflict cannot overwrite external progress when its recovery copy cannot be written", () => {
  const h = storageHarness();
  let offline = true, refuseBackup = false;
  const local = new ProfileStore({ ...h.storage, setItem(key, value) {
    if (offline || (refuseBackup && key.startsWith("ink-battlefield.profile.conflict."))) throw Error("quota");
    h.storage.setItem(key, value);
  } });
  local.load();
  local.checkpoint({ classId: "assault", seed: 1, completed: 1, upgrades: [], weapons: ["rifle"] });
  const other = new ProfileStore(h.storage);
  other.checkpoint({ classId: "heavy", seed: 2, completed: 4, upgrades: [], weapons: ["shotgun"] });
  const external = h.values.get(PROFILE_KEY);
  offline = false; refuseBackup = true;
  assert.equal(local.retrySave(), false);
  assert.equal(h.values.get(PROFILE_KEY), external);
  assert.equal(local.load().checkpoint?.seed, 1, "the unsaved local run remains available in this page");
  assert.equal(local.hasUnsavedChanges, true);
  refuseBackup = false;
  assert.equal(local.retrySave(), true);
  assert.equal(new ProfileStore(h.storage).load().checkpoint?.seed, 1);
});
