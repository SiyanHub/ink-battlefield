import test from "node:test";
import assert from "node:assert/strict";
import { GameController } from "../src/client/ui/controller";
import { renderMenu } from "../src/client/ui/views";
import { renderHud } from "../src/client/ui/hud";
import { Simulation } from "../src/core/simulation";
import { overlayFor } from "../src/client/presenter";
import { TurfSession } from "../src/session/turf";
import { LocalSessionDriver } from "../src/session/local-driver";

test("a paused local competitor can resume even while waiting to respawn", () => {
  assert.equal(overlayFor("paused", false, true, true), "pause");
});

test("the home page exposes local turf, a map choice and a separate LAN route", async () => {
  const game = new GameController();
  try {
    assert.match(renderMenu(game), /data-action="turf"/);
    await game.action("turf");
    assert.equal(game.state.mode, "turf");
    assert.match(renderMenu(game), /4 分钟/);
    assert.match(renderMenu(game), /电脑队友/);
    assert.match(renderMenu(game), /id="turf-map"/);
    assert.match(renderMenu(game), /data-action="turf-network"/);
    await game.action("turf-network");
    assert.equal(game.state.screen, "network");
    assert.match(renderMenu(game), /双队涂地/);
  } finally { game.leave(); }
});

test("turf HUD exposes both absolute floor shares, unpainted share and deadline", () => {
  const sim = new Simulation({ modeId: "turf", teamMode: true });
  sim.addPlayer("local", "玩家", "artist", [], "blue");
  const snapshot = sim.getSnapshot();
  snapshot.scores = { blue: 25, red: 35 }; snapshot.remaining = 61;
  const html = renderHud(snapshot, "local", false);
  assert.match(html, /蓝墨队/); assert.match(html, /朱墨队/);
  assert.match(html, /25\.0%/); assert.match(html, /35\.0%/);
  assert.match(html, /未染色 40\.0%/); assert.match(html, /01:01/);
  assert.match(html, /你的队伍/);
  assert.doesNotMatch(html, /35 \/ 100/);
  snapshot.scores = { blue: 25.01, red: 25 };
  assert.match(renderHud(snapshot, "local", false), /蓝墨队微弱领先/);
  assert.doesNotMatch(renderHud(snapshot, "local", false), /双方持平/);
});

test("local turf launches without a lobby, can pause and restarts with clean paint", async () => {
  const game = new GameController(); const before = game.store.load();
  try {
    await game.action("turf"); await game.action("begin");
    assert.equal(game.session?.getSnapshot().modeId, "turf");
    assert.equal(game.lobby, null);
    game.toggleMenu();
    assert.equal(game.session?.getSnapshot().phase, "paused");
    const old = game.session;
    await game.action("turf-restart");
    assert.notEqual(game.session, old);
    assert.equal(game.session?.getSnapshot().paint.surfaces.length, 0);
    assert.deepEqual(game.store.load(), before);
  } finally { game.leave(); }
});

for (const [mapId, seed, winner, title] of [
  ["construction", 2, "blue", "这一页，属于你。"],
  ["street", 9, "red", "胜负留待下一页。"],
] as const) test(`a completed offline turf match on ${mapId} presents the local team's result`, async () => {
  const game = new GameController();
  try {
    await game.action("turf");
    const session = new TurfSession({ classId: "artist", mapId, autoStart: false, seed });
    game.start(session);
    session.advance(240);
    const result = session.getSnapshot();
    assert.equal(result.phase, "victory", "competitive completion uses one phase for either winner");
    assert.equal(result.winner, winner);
    const html = renderMenu(game);
    assert.ok(html.includes(title));
    assert.match(html, /最终覆盖/); assert.match(html, /时间到/);
    assert.match(html, /data-action="turf-restart"/);
    assert.doesNotMatch(html, /data-action="rematch"/);
  } finally { game.leave(); }
});

test("an actual four-minute unpainted turf match presents a draw", async () => {
  const game = new GameController();
  try {
    await game.action("turf");
    const simulation = new Simulation({ modeId: "turf", teamMode: true, allowPause: true });
    simulation.addPlayer("local", "玩家", "artist", [], "blue");
    const session = new LocalSessionDriver("local", simulation);
    game.start(session); session.advance(240);
    assert.equal(session.getSnapshot().winner, null);
    const html = renderMenu(game);
    assert.match(html, /平局 · 各有千秋。/);
    assert.match(html, /未染色 100\.0%/);
  } finally { game.leave(); }
});
