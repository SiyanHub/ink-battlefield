import test from "node:test";
import assert from "node:assert/strict";
import { GameController } from "../src/client/ui/controller";
import { renderMenu } from "../src/client/ui/views";
import { ProfileStore } from "../src/profile/store";
import { PracticeSession } from "../src/session/practice";
import { neutralInput } from "../src/shared/contracts";
import { maps } from "../src/content";

test("campaign equipment offers optional guided practice without blocking direct play", async () => {
  const game = new GameController();
  try {
    await game.action("solo");
    assert.match(renderMenu(game), /data-action="guided-practice"/);
    assert.match(renderMenu(game), /data-action="begin"/);
    await game.action("guided-practice");
    assert.equal(game.session?.getSnapshot().modeId, "practice");
    game.toggleMenu();
    await game.action("guide-campaign");
    assert.equal(game.state.mode, "campaign");
    assert.equal(game.state.screen, "class");
  } finally { game.leave(); }
});

test("practice offers local image capture, forwards comparison mode and reports export errors", async () => {
  const exported: boolean[] = [], notices: string[] = [];
  const game = new GameController(undefined, {
    capture: async (_snapshot, compare) => { exported.push(compare); if (compare) throw new Error("留影编码失败"); },
    notice: text => notices.push(text),
  });
  try {
    await game.action("practice"); await game.action("begin");
    const before = game.session!.getSnapshot();
    await game.action("capture"); await game.action("capture-compare");
    assert.deepEqual(exported, [false, true]);
    assert.ok(notices.some(text => text.includes("留影编码失败")));
    assert.equal(game.state.busy, false);
    assert.equal(game.session!.getSnapshot().phase, before.phase);
  } finally { game.leave(); }
});

test("guided practice tracks real shots, reloads, weapon changes and successful abilities without changing campaign progress", async () => {
  const store = new ProfileStore(), before = store.load(), game = new GameController(store);
  const practice = new PracticeSession({ classId: "assault", weapons: ["rifle", "smg"], autoStart: false });
  try {
    await game.action("solo");
    await game.action("guided-practice");
    game.start(practice);
    let seq = 0;
    const input = (extra: Partial<ReturnType<typeof neutralInput>>) => {
      practice.submitInput({ ...neutralInput(), seq: ++seq, ...extra }); practice.advance(1 / 60);
    };
    input({ primary: true }); input({ primary: false });
    input({ reload: true }); input({ reload: false }); practice.advance(2);
    input({ slot: 1 }); input({ skill: true });
    assert.ok(game.quickStart, "guided practice must expose completed actions to its HUD");
    const guide = game.quickStart.view();
    for (const id of ["fire", "reload", "switch", "skill"])
      assert.equal(guide.steps.find(step => step.id === id)?.done, true, id);
    assert.equal(guide.steps.find(step => step.id === "grapple")?.done, false);
    assert.equal(guide.complete, false);
    practice.advance(.3); // Finish the assault dash before aiming the camera.
    const snapshot = practice.getSnapshot(), self = snapshot.actors.find(actor => actor.id === practice.playerId)!;
    const anchor = [...maps[snapshot.mapId].anchors].sort((a, b) =>
      Math.hypot(a.x - self.pos.x, a.y - self.pos.y, a.z - self.pos.z) -
      Math.hypot(b.x - self.pos.x, b.y - self.pos.y, b.z - self.pos.z))[0];
    const dx = anchor.x - self.pos.x, dy = anchor.y - self.pos.y - 1.62, dz = anchor.z - self.pos.z;
    const aim = { yaw: Math.atan2(-dx, -dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)) };
    input(aim); input({ ...aim, grapple: true });
    const afterGrapple = practice.getSnapshot();
    assert.ok(afterGrapple.actors.find(actor => actor.id === practice.playerId)!.grappleCooldown > afterGrapple.time);
    assert.equal(game.quickStart.view().steps.find(step => step.id === "grapple")?.done, true);
    assert.equal(game.quickStart.view().complete, true);
    assert.deepEqual(store.load(), before);
  } finally { game.leave(); practice.dispose(); }
});

test("practice has a pause for export that retains paint and guidance until resumed", async () => {
  const game = new GameController();
  try {
    await game.action("guided-practice"); const session = game.session!;
    await game.action("practice-pause");
    assert.equal(game.session, session); assert.equal(session.getSnapshot().phase, "paused");
    assert.match(renderMenu(game), /data-action="capture-compare"/);
    await game.action("resume");
    assert.equal(game.session, session); assert.equal(session.getSnapshot().phase, "playing");
  } finally { game.leave(); }
});
