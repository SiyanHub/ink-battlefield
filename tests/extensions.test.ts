import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/core/simulation";
import { neutralInput } from "../src/shared/contracts";
import { registerExamples } from "../examples/register";

test("an added weapon and mode run through the unchanged public simulation interface", () => {
  registerExamples();
  const sim = new Simulation({
    modeId: "example-quick-sketch",
    mapId: "construction",
  });
  sim.addPlayer("p", "试笔", "artist", ["example-chalk"]);
  sim.input("p", { ...neutralInput(), seq: 1, primary: true, pitch: 1.2 });
  sim.step();
  sim.input("p", { ...neutralInput(), seq: 2, pitch: 1.2 });
  sim.advance(.1);
  const frame = sim.takeFrame();
  assert.equal(frame.snapshot.actors[0].weaponId, "example-chalk");
  assert.ok(
    frame.events.some(
      (e) => e.type === "shot" && e.weaponId === "example-chalk",
    ),
  );
  assert.ok(frame.snapshot.paint.surfaces.some((s) => s.cells.length > 0));
  sim.advance(5);
  assert.equal(sim.getSnapshot().phase, "victory");
  assert.equal(sim.getSnapshot().winner, "p");
});
