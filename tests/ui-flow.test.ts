import test from "node:test";
import assert from "node:assert/strict";
import { GameController } from "../src/client/ui/controller";
import { renderMenu } from "../src/client/ui/views";
import { ProfileStore } from "../src/profile/store";

test("free practice opens equipment with every class weapon available and leaves the campaign archive untouched", async () => {
  const store = new ProfileStore();
  const before = store.load();
  const game = new GameController(store);
  assert.match(renderMenu(game), /data-action="practice"/);
  await game.action("practice");
  await game.action("class", { id: "scout" });
  assert.equal(game.state.screen, "class");
  assert.equal(game.state.mode, "practice");
  const html = renderMenu(game);
  assert.match(html, /自由试笔/);
  assert.match(html, /value="sniper"/);
  assert.match(html, /value="bow"/);
  assert.doesNotMatch(html, /disabled/);
  assert.deepEqual(store.load(), before);
});

test("Esc from a live practice returns equipment and a fresh trial keeps choices without writing a checkpoint", async () => {
  const store = new ProfileStore();
  const profile = store.load();
  profile.checkpoint = { classId: "heavy", seed: 42, completed: 2, upgrades: [], weapons: ["shotgun", "lmg", "hammer"] };
  store.save(profile);
  const game = new GameController(store);
  try {
    await game.action("practice");
    await game.action("class", { id: "scout" });
    game.change("slot:0", "bow");
    game.change("slot:1", "");
    await game.action("begin");
    const first = game.session!;
    assert.equal(first.getSnapshot().modeId, "practice");
    assert.equal(game.state.screen, "game");
    game.toggleMenu();
    assert.equal(game.session, null);
    assert.equal(game.state.screen, "class");
    assert.deepEqual(game.state.loadout, ["bow", "", "compass"]);
    const stoppedTick = first.getSnapshot().tick;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(first.getSnapshot().tick, stoppedTick);
    await game.action("begin");
    assert.notEqual(game.session, first);
    assert.equal(game.session!.getSnapshot().actors.find(a => a.id === game.session!.playerId)?.weaponId, "bow");
    assert.deepEqual(store.load(), { ...profile, checkpoint: { ...profile.checkpoint!, totalKills: 0 } });
  } finally { game.leave(); }
});

test("campaign pause and settings resume retain the active session and checkpoint continuation", async () => {
  const store = new ProfileStore();
  const profile = store.load();
  profile.checkpoint = { classId: "heavy", seed: 42, completed: 2, upgrades: [], weapons: ["shotgun", "lmg", "hammer"] };
  store.save(profile);
  const game = new GameController(store);
  try {
    await game.action("continue-save");
    const session = game.session!;
    assert.equal(game.state.selected, "heavy");
    assert.equal(session.getSnapshot().campaign?.completed, 2);
    game.toggleMenu();
    assert.equal(session.getSnapshot().phase, "paused");
    assert.match(renderMenu(game), /战场已暂停/);
    await game.action("settings");
    game.change("setting:volume", 0.25);
    await game.action("resume");
    assert.equal(game.session, session);
    assert.equal(session.getSnapshot().phase, "playing");
    assert.equal(store.load().settings.volume, 0.25);
  } finally { game.leave(); }
});

test("returning home during practice loading cancels the pending launch", async () => {
  const game = new GameController();
  try {
    await game.action("practice");
    const loading = game.action("begin");
    await game.action("home");
    await loading;
    assert.equal(game.state.screen, "home");
    assert.equal(game.session, null);
  } finally { game.leave(); }
});

test("room start explains unmet player, readiness and team requirements before enabling launch", () => {
  const game = new GameController();
  game.state.screen = "room";
  game.state.mode = "network";
  const member = { id: "host", name: "画手", classId: "assault" as const, weapons: ["rifle", "smg", "katana"], teamId: "blue", connected: true, ready: false };
  game.room = { code: "ABC123", hostId: "host", status: "lobby", settings: { modeId: "deathmatch", mapId: "construction", teamMode: false, maxPlayers: 8 }, members: [member] };
  let html = renderMenu(game);
  assert.match(html, /data-action="start-room"[^>]*disabled/);
  assert.match(html, /至少 2 位在线玩家/);
  member.ready = true;
  game.room.members.push({ ...member, id: "guest", ready: false });
  html = renderMenu(game);
  assert.match(html, /data-action="start-room"[^>]*disabled/);
  assert.match(html, /所有玩家确认装备并准备/);
  game.room.members[1].ready = true;
  game.room.members[1].connected = false;
  html = renderMenu(game);
  assert.match(html, /data-action="start-room"[^>]*disabled/);
  assert.match(html, /所有玩家在线/);
  game.room.members[1].connected = true;
  game.room.settings.teamMode = true;
  html = renderMenu(game);
  assert.match(html, /data-action="start-room"[^>]*disabled/);
  assert.match(html, /蓝墨队与朱墨队各至少 1 人/);
  game.room.members[1].teamId = "red";
  assert.doesNotMatch(renderMenu(game), /data-action="start-room"[^>]*disabled/);
  game.room.settings.modeId = "control";
  game.room.settings.teamMode = true;
  game.room.members[1].teamId = "blue";
  assert.match(renderMenu(game), /data-action="start-room"[^>]*disabled/);
});
