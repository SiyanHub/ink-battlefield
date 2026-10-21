import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { maps, enemies, weapons, classes } from "../src/content";
import {
  neutralInput,
  type ClassId,
  type PaintSnapshot,
} from "../src/shared/contracts";

const base = maps.construction;
const ground = base.boxes.find((b) => b.id === "ground")!;
const floor = base.surfaces.find((s) => s.id === "ground:top")!;
const arena = {
  ...base,
  boxes: [ground],
  surfaces: [floor],
  spawns: [{ x: 0, y: 0, z: 0 }],
  enemySpawns: [{ x: 0, y: 0, z: -5 }],
  objectives: [base.objectives[0]],
};
const paint: PaintSnapshot = {
  revision: 1,
  surfaces: [
    {
      id: floor.id,
      revision: 1,
      cells: Array.from(
        {
          length:
            Math.ceil(floor.width / floor.cellSize) *
            Math.ceil(floor.height / floor.cellSize),
        },
        (_, i) => [i, 0x44bda7, "player"],
      ),
    },
  ],
};
const weakEnemies = Object.fromEntries(
  Object.entries(enemies).map(([id, e]) => [
    id,
    { ...e, hp: 1, speed: 0, damage: 0 },
  ]),
);
const strongWeapons = Object.fromEntries(
  Object.entries(weapons).map(([id, w]) => [
    id,
    { ...w, damage: 10000, spread: 0 },
  ]),
);

for (const classId of Object.keys(classes) as ClassId[])
  test(`${classId} completes nine public Simulation encounters with shooting and upgrade commands`, () => {
    let upgrades: string[] = [];
    for (let completed = 0; completed < 9; completed++) {
      const s = new Simulation({
        modeId: "solo",
        map: arena,
        seed: 7,
        campaign: { completed, upgrades, duration: 2, groups: 1 },
        content: { enemies: weakEnemies, weapons: strongWeapons },
        initialPaint: paint,
      });
      s.addPlayer("player", "玩家", classId, [], "player", {
        x: 0,
        y: 0,
        z: 0,
      });
      const initial = s.getSnapshot();
      assert.equal(initial.campaign?.completed, completed);
      let sawEnemy = false,
        sawShot = false,
        sawDeath = false,
        frame = initial;
      for (let tick = 0; tick < 600 && frame.phase === "playing"; tick++) {
        const target = frame.actors.find((a) => a.kind === "enemy" && a.alive);
        const yaw = target ? Math.atan2(-target.pos.x, -target.pos.z) : 0;
        const pitch = target
          ? Math.atan2(
              0.25 - target.pos.y,
              Math.hypot(target.pos.x, target.pos.z),
            )
          : 0.12;
        s.input("player", {
          ...neutralInput(),
          seq: tick,
          primary: tick % 2 === 0,
          yaw,
          pitch,
          reload: tick % 60 === 0,
        });
        s.step();
        const output = s.takeFrame();
        frame = output.snapshot;
        sawEnemy ||= frame.actors.some((a) => a.kind === "enemy");
        sawShot ||= output.events.some(
          (e) => e.type === "shot" && e.actorId === "player",
        );
        sawDeath ||= output.events.some(
          (e) => e.type === "death" && e.targetId?.startsWith("enemy-"),
        );
      }
      assert.ok(sawEnemy, `stage ${completed}: spawned a real enemy`);
      assert.ok(sawShot, `stage ${completed}: weapon fired`);
      assert.ok(sawDeath, `stage ${completed}: enemy died through combat`);
      assert.equal(
        frame.campaign?.completed,
        completed + 1,
        `stage ${completed} completion: ${JSON.stringify({ phase: frame.phase, remaining: frame.actors.filter((a) => a.kind === "enemy" && a.alive).map((a) => ({ id: a.enemyId, pos: a.pos, hp: a.hp })), player: frame.actors.find((a) => a.id === "player")?.pos })}`,
      );
      assert.equal(frame.campaign?.chapter, Math.floor(completed / 3));
      assert.equal(frame.campaign?.encounter, completed % 3);
      if (completed === 8) {
        assert.equal(frame.phase, "victory");
        assert.equal(frame.campaign?.won, true);
      } else {
        assert.equal(frame.phase, "upgrade");
        assert.equal(frame.campaign?.choices.length, 3);
        const choice = frame.campaign!.choices[0];
        s.command("player", { type: "upgrade", upgradeId: choice });
        assert.equal(s.canContinue(), true);
        upgrades = [
          ...s.getSnapshot().actors.find((a) => a.id === "player")!.upgrades,
        ];
        assert.ok(upgrades.includes(choice));
      }
    }
  });

test("default deathmatch ends at six minutes with an explicit draw at zero score", () => {
  const s = new Simulation({ modeId: "deathmatch", map: arena, seed: 4 });
  s.addPlayer("red", "红", "artist", ["roller"], "red");
  s.addPlayer("blue", "蓝", "artist", ["roller"], "blue");
  s.advance(360);
  const snap = s.getSnapshot();
  assert.equal(snap.phase, "victory");
  assert.equal(snap.remaining, 0);
  assert.equal(snap.winner, null);
  assert.equal(snap.scores.red ?? 0, 0);
});

test("default control scores current-zone floor coverage and ends at 200", () => {
  const redPaint: PaintSnapshot = {
    ...paint,
    surfaces: paint.surfaces.map((s) => ({
      ...s,
      cells: s.cells.map(([index, color]) => [index, color, "red"]),
    })),
  };
  const s = new Simulation({
    modeId: "control",
    map: arena,
    seed: 4,
    initialPaint: redPaint,
  });
  s.addPlayer("red", "红", "artist", ["roller"], "red");
  s.addPlayer("blue", "蓝", "artist", ["roller"], "blue");
  s.advance(205);
  const snap = s.getSnapshot();
  assert.equal(snap.phase, "victory");
  assert.equal(snap.winner, "red");
  assert.ok(snap.scores.red >= 200);
  assert.equal(snap.objective.zoneId, "A");
});

test("default turf compares effective floor area after four minutes", () => {
  const redPaint: PaintSnapshot = {
    ...paint,
    surfaces: paint.surfaces.map((s) => ({
      ...s,
      cells: s.cells.map(([index, color]) => [index, color, "red"]),
    })),
  };
  const s = new Simulation({
    modeId: "turf",
    map: arena,
    seed: 4,
    initialPaint: redPaint,
  });
  s.addPlayer("red", "红", "artist", ["roller"], "red");
  s.addPlayer("blue", "蓝", "artist", ["roller"], "blue");
  s.advance(240);
  const snap = s.getSnapshot();
  assert.equal(snap.phase, "victory");
  assert.equal(snap.winner, "red");
  assert.ok(
    snap.scores.red > snap.scores.blue! || snap.scores.blue === undefined,
  );
});
