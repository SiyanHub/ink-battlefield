import test from "node:test";
import assert from "node:assert/strict";
import { GameController } from "../src/client/ui/controller";
import { renderMenu } from "../src/client/ui/views";
import { renderHud } from "../src/client/ui/hud";
import { BattleFeedback } from "../src/client/ui/feedback";
import { PracticeSession } from "../src/session/practice";
import type { GameFrame, GameSession } from "../src/shared/contracts";

test("equipment explains selected weapons with the current mode's damage and firing controls", async () => {
  const game = new GameController();
  await game.action("solo");
  await game.action("class", { id: "heavy" });
  let page = renderMenu(game);
  assert.match(page, /九枚弹丸，近距离冲击/);
  assert.match(page, /12 点 \/ 每弹丸/);
  assert.match(page, /6 发弹匣/);
  assert.match(page, /2 秒换弹/);
  assert.match(page, /27 米射程/);
  assert.match(page, /半自动 · 点按左键/);
  assert.match(page, /全自动 · 按住左键/);
  await game.action("practice");
  page = renderMenu(game);
  assert.match(page, /对战基础数值/);
  assert.match(page, /8 点 \/ 每弹丸/);
  let changes = 0;
  const selection = new GameController(undefined, { changed: () => changes++ });
  await selection.action("solo");
  const before = changes;
  selection.change("slot:1", "carbine");
  assert.ok(changes > before, "changing a weapon refreshes its visible description");
  assert.match(renderMenu(selection), /半自动 · 点按左键，三发点射/);
});

test("battle feedback confirms own hits and kills, expires, deduplicates replay and resets on a new session", () => {
  const session = new PracticeSession({ classId: "assault", autoStart: false });
  const snapshot = structuredClone(session.getSnapshot());
  const playerId = session.playerId, target = snapshot.actors.find(a => a.kind === "enemy")!;
  target.name = "目标<&>";
  const feedback = new BattleFeedback();
  const events = [
    { id: 1, type: "hit" as const, actorId: "other", targetId: target.id, amount: 11 },
    { id: 2, type: "hit" as const, actorId: playerId, targetId: target.id, amount: 11 },
    { id: 3, type: "death" as const, actorId: playerId, targetId: target.id },
  ];
  feedback.apply({ snapshot, events }, playerId, 10);
  let html = renderHud(snapshot, playerId, false, feedback.view(10));
  assert.match(html, /命中/);
  assert.match(html, /击倒 · 目标&lt;&amp;&gt;/);
  feedback.apply({ snapshot, events }, playerId, 13);
  html = renderHud(snapshot, playerId, false, feedback.view(13));
  assert.doesNotMatch(html, /命中|击倒 ·/);
  for (let id = 4; id <= 14; id++) feedback.apply({ snapshot, events: [{ id, type: "death", actorId: playerId, targetId: target.id }] }, playerId, 14);
  assert.equal((renderHud(snapshot, playerId, false, feedback.view(14)).match(/击倒 ·/g) ?? []).length, 3);
  feedback.reset();
  assert.doesNotMatch(renderHud(snapshot, playerId, false, feedback.view(14)), /命中|击倒 ·/);
  feedback.apply({ snapshot, events }, playerId, 15);
  assert.match(renderHud(snapshot, playerId, false, feedback.view(15)), /命中/);
  session.dispose();
});

test("damage gives a brief edge cue, low health remains readable and the controller clears session feedback", () => {
  const session = new PracticeSession({ classId: "assault", autoStart: false });
  const game = new GameController();
  game.start(session);
  const snapshot = structuredClone(session.getSnapshot());
  const player = snapshot.actors.find(a => a.id === session.playerId)!;
  game.feedback.apply({ snapshot, events: [{ id: 1, type: "hit", targetId: player.id, amount: 15 }] }, player.id, 1);
  assert.match(renderHud(snapshot, player.id, false, game.feedback.view(1)), /class="damage-edge"/);
  assert.doesNotMatch(renderHud(snapshot, player.id, false, game.feedback.view(2)), /class="damage-edge"/);
  player.hp = 20;
  assert.match(renderHud(snapshot, player.id, false, game.feedback.view(2)), /生命偏低 · 寻找掩护/);
  assert.doesNotMatch(renderHud(snapshot, player.id, false, game.feedback.view(1, true)), /class="damage-edge"/);
  game.feedback.apply({ snapshot, events: [{ id: 2, type: "hit", actorId: player.id, targetId: "target" }] }, player.id, 3);
  game.leave();
  assert.doesNotMatch(renderHud(snapshot, player.id, false, game.feedback.view(3)), /命中/);
  let deliver: (frame: GameFrame) => void = () => {};
  const second: GameSession = {
    playerId: player.id, getSnapshot: () => snapshot,
    submitInput: () => {}, command: () => {}, dispose: () => {},
    subscribe: listener => { deliver = listener; return () => { deliver = () => {}; }; },
  };
  game.start(second);
  deliver({ snapshot, events: [{ id: 1, type: "hit", actorId: second.playerId, targetId: "target", amount: 10 }] });
  assert.match(renderHud(second.getSnapshot(), second.playerId, false, game.feedback.view()), /命中/);
  game.leave();
});

test("HUD uses practice objectives, live boss health, observed reload timing and charge upgrades", () => {
  const session = new PracticeSession({ classId: "scout", weapons: ["bow", "sniper", "compass"], autoStart: false });
  const snapshot = structuredClone(session.getSnapshot());
  const player = snapshot.actors.find(a => a.id === session.playerId)!;
  snapshot.objective = { title: "三项试笔", description: "命中、涂地与切换画具", progress: 2, target: 3, remaining: 0 };
  const boss = snapshot.actors.find(a => a.kind === "enemy")!;
  Object.assign(boss, { enemyId: "doodler", name: "涂鸦巨像", hp: 1800, maxHp: 3600 });
  snapshot.time = 10;
  player.ammo.bow.reloadUntil = 11.4;
  const feedback = new BattleFeedback();
  feedback.apply({ snapshot, events: [] }, player.id, 1);
  snapshot.time = 10.7;
  feedback.apply({ snapshot, events: [] }, player.id, 1.7);
  let html = renderHud(snapshot, player.id, false, feedback.view(1.7));
  assert.match(html, /命中、涂地与切换画具/);
  assert.match(html, /aria-label="任务进度" max="3" value="2"/);
  assert.match(html, /aria-label="涂鸦巨像生命" max="3600" value="1800"/);
  assert.match(html, /aria-label="换弹进度" max="1" value="0.500"/);
  assert.match(html, /换弹 · 0.7s/);
  player.ammo.bow.reloadUntil = 0;
  player.ammo.bow.chargeStarted = 10.7;
  player.upgrades = ["quickcharge"];
  snapshot.time = 11.085;
  html = renderHud(snapshot, player.id, false);
  assert.match(html, /aria-label="蓄力进度" max="1" value="0.500"/);
  assert.match(html, /蓄力 50% · 松开射击/);
  snapshot.time = 12;
  boss.alive = false;
  html = renderHud(snapshot, player.id, false);
  assert.match(html, /满蓄 · 松开射击/);
  assert.doesNotMatch(html, /aria-label="涂鸦巨像生命"/);
  session.dispose();
});
