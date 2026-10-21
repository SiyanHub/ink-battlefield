import test from "node:test";
import assert from "node:assert/strict";
import { GameController } from "../src/client/ui/controller";
import { renderMenu } from "../src/client/ui/views";
test("hosted preview explains LAN setup instead of offering a room on the static website", () => {
  const game = new GameController(undefined, {}, "", true);
  game.state.screen = "network";
  const menu = renderMenu(game);
  assert.match(menu, /启动局域网/);
  assert.doesNotMatch(menu, /data-action="(?:join|create)"/);
});
test("objective room locks the team toggle while deathmatch leaves it selectable", () => {
  const game = new GameController();
  game.state.screen = "room";
  game.state.mode = "network";
  game.room = {
    code: "ABC123", hostId: "host", status: "lobby",
    settings: { modeId: "control", mapId: "construction", teamMode: true, maxPlayers: 2 },
    members: [],
  };
  assert.match(renderMenu(game), /data-room="teamMode"[^>]*checked[^>]*disabled/);
  game.room.settings = { ...game.room.settings, modeId: "deathmatch", teamMode: false };
  assert.match(renderMenu(game), /data-room="teamMode"/);
  assert.doesNotMatch(renderMenu(game), /data-room="teamMode"[^>]*disabled/);
});
import { resultTitle } from "../src/client/presenter";
import { floorOwnership } from "../src/client/presenter";
import { maps } from "../src/content";
import { PaintField } from "../src/core/paint";
test("floor inspection distinguishes an upper floor from the painted floor below it", () => {
  const m = maps.construction,
    field = new PaintField(m.surfaces, m.boxes);
  field.stamp("ground:top", { x: -13, y: 0, z: -4 }, 3, "red", 0xff0000);
  field.stamp(
    "platform-west:top",
    { x: -13, y: 4, z: -4 },
    3,
    "blue",
    0xff0000,
  );
  assert.equal(
    floorOwnership(m, field.snapshot(), { x: -13, y: 4, z: -4 }),
    "blue",
  );
  assert.equal(
    floorOwnership(m, field.snapshot(), { x: -13, y: 0, z: -4 }),
    "red",
  );
});
test("each competitor sees their own win loss or explicit draw result", () => {
  assert.equal(resultTitle("victory", "red", "blue", true), "胜负留待下一页。");
  assert.equal(
    resultTitle("victory", "blue", "blue", true),
    "这一页，属于你。",
  );
  assert.equal(resultTitle("victory", null, "blue", true), "平局 · 各有千秋。");
});
import { menuTransition } from "../src/client/presenter.js";
test("opening the online menu keeps the match running, local menu pauses it", () => {
  assert.deepEqual(menuTransition(false, true), { open: true, command: null });
  assert.deepEqual(menuTransition(false, false), {
    open: true,
    command: "pause",
  });
  assert.deepEqual(menuTransition(true, false), {
    open: false,
    command: "resume",
  });
});
import { overlayFor } from "../src/client/presenter.js";
test("a fallen online player can change equipment while a completed match shows results", () => {
  assert.equal(overlayFor("playing", false, true, false), "respawn");
  assert.equal(overlayFor("victory", false, true, false), "results");
  assert.equal(overlayFor("upgrade", true, false, false), "upgrade");
});
import { PaintPresentation } from "../src/client/presenter.js";
test("new-match reset accepts reused paint revisions and reconnect restores the full current battlefield", () => {
  const view = new PaintPresentation();
  view.apply({
    revision: 1,
    surfaces: [{ id: "floor", revision: 1, cells: [[0, 0xff0000, "a"]] }],
  });
  view.reset();
  assert.deepEqual(
    view
      .apply({
        revision: 1,
        surfaces: [{ id: "floor", revision: 1, cells: [[0, 0x0000ff, "b"]] }],
      })
      .get("floor")?.cells,
    [[0, 0x0000ff, "b"]],
  );
  assert.equal(view.apply({ revision: 2, surfaces: [] }).get("floor"), null);
  assert.equal(
    view
      .apply({
        revision: 3,
        surfaces: [{ id: "floor", revision: 1, cells: [[0, 0xff0000, "a"]] }],
      })
      .get("floor")?.cells[0][1],
    0xff0000,
  );
});
import { TeamSelection, spectatorPosition } from "../src/client/presenter.js";
test("red team choice survives member refreshes while first room snapshot can initialize the current team", () => {
  const team = new TeamSelection();
  team.initialize("red");
  assert.equal(team.value, "red");
  team.choose("blue");
  team.initialize("red");
  assert.equal(team.value, "blue");
  team.choose("red");
  team.initialize("blue");
  assert.equal(team.value, "red");
});
test("joining from a free-for-all identity keeps a valid default team for the room controls", () => {
  const team = new TeamSelection();
  team.initialize("player-uuid");
  assert.equal(team.value, "blue");
  team.initialize("red");
  assert.equal(team.value, "red");
});
test("spectator moves locally in view direction and can gain altitude", () => {
  assert.deepEqual(spectatorPosition({ x: 0, y: 2, z: 0 }, 0, 1, 0, 1, 1), {
    x: 0,
    y: 8,
    z: -6,
  });
});
import { Input } from "../src/client/input.js";
import { aimingView } from "../src/client/presenter.js";
import { weapons } from "../src/content";
test("right mouse aims ordinary guns and opens the sniper scope only during active play", () => {
  assert.equal(aimingView(weapons.rifle, true, true).mode, "sights");
  assert.ok(aimingView(weapons.rifle, true, true).fov < aimingView(weapons.rifle, false, true).fov);
  assert.equal(aimingView(weapons.sniper, true, true).mode, "scope");
  assert.ok(aimingView(weapons.sniper, true, true).fov < aimingView(weapons.rifle, true, true).fov);
  assert.equal(aimingView(weapons.sniper, false, true).mode, "hip");
  assert.equal(aimingView(weapons.sniper, true, false).mode, "hip");
  assert.equal(aimingView(weapons.katana, true, true).mode, "hip");
});
test("blur and pointer unlock release firing, drag aim, queued slot and scoreboard", () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const win = Object.assign(new EventTarget(), { matches: () => false });
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null });
  const canvas = Object.assign(new EventTarget(), {
    requestPointerLock: () => Promise.resolve(),
  });
  let scoreboard = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: win,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: doc,
  });
  const emit = (
    target: EventTarget,
    type: string,
    values: Record<string, unknown> = {},
  ) => {
    const event = new Event(type);
    Object.assign(event, values);
    target.dispatchEvent(event);
  };
  try {
    const input = new Input(
      canvas as unknown as HTMLCanvasElement,
      () => 1,
      () => {},
      (show) => (scoreboard = show),
      () => {},
    );
    input.enabled = true;
    emit(canvas, "mousedown", { button: 0 });
    emit(win, "keydown", { code: "Digit2", repeat: false });
    emit(win, "keydown", { code: "Tab", repeat: false });
    emit(win, "blur");
    emit(win, "mousemove", { movementX: 100, movementY: 100 });
    const sampled = input.sample(0);
    assert.equal(sampled.primary, false);
    assert.equal(sampled.slot, null);
    assert.equal(input.yaw, 0);
    assert.equal(scoreboard, false);
    emit(canvas, "mousedown", { button: 0 });
    emit(doc, "pointerlockchange");
    assert.equal(input.sample(0).primary, false);
    emit(canvas, "wheel", { deltaY: 1 });
    assert.equal(input.sample(0, [0, 2]).slot, 2);
    emit(win, "keydown", { code: "Digit2", repeat: false });
    assert.equal(input.sample(0, [0, 2]).slot, null);
    emit(canvas, "mousedown", { button: 2 });
    assert.equal(input.sample(0).secondary, true);
    emit(canvas, "mousedown", { button: 0 });
    emit(win, "mouseup", { button: 0 });
    emit(win, "mousemove", { movementX: 10, movementY: 0 });
    assert.notEqual(input.yaw, 0, "releasing fire must keep right-button drag aiming active");
    emit(win, "keydown", { code: "Digit2", repeat: false });
    assert.equal(input.sample(0).secondary, false, "switching weapons exits aim");
    emit(canvas, "mousedown", { button: 2 });
    emit(win, "mouseup", { button: 2 });
    assert.equal(input.sample(1).secondary, false);
    emit(canvas, "mousedown", { button: 2 });
    emit(win, "blur");
    assert.equal(input.sample(1).secondary, false);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
import { cycleEquipmentSlot } from "../src/client/presenter.js";
test("scrolling skips an empty second weapon slot in both directions", () => {
  assert.equal(cycleEquipmentSlot(0, 1, [0, 2]), 2);
  assert.equal(cycleEquipmentSlot(2, 1, [0, 2]), 0);
  assert.equal(cycleEquipmentSlot(0, -1, [0, 2]), 2);
  assert.equal(cycleEquipmentSlot(1, 1, [0, 2]), 2);
  assert.equal(cycleEquipmentSlot(0, 1, []), null);
});
