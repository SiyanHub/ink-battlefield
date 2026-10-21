import { test } from "node:test";
import assert from "node:assert/strict";
import { getLoadout, createRegistry } from "../src/content/registry";
test("a heavy can select two unlocked class weapons and always carries the class melee", () => {
  assert.deepEqual(
    getLoadout(
      "heavy",
      ["grenade", "shotgun", "sniper"],
      ["shotgun", "grenade", "hammer"],
    ),
    ["grenade", "shotgun", "hammer"],
  );
});
test("independent content registration rejects collisions rather than replacing behavior", () => {
  const registry = createRegistry<{ id: string }>();
  registry.register({ id: "extra" });
  assert.throws(() => registry.register({ id: "extra" }), /duplicate/);
  assert.equal(registry.get("extra").id, "extra");
});
