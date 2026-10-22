import test from "node:test";
import assert from "node:assert/strict";
import { Mesh, MeshBasicMaterial } from "three";
import { CombatEffects } from "../src/client/scene/CombatEffects";

test("paint impacts emit a bounded pool of team-colored droplets and settle away", () => {
  const effects = new CombatEffects();
  try {
    const initialCount = effects.root.children.length;
    for (let i = 0; i < 100; i++) effects.event({ id: i, type: "paint", pos: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, color: 0x1977bd });
    const visible = effects.root.children.filter(o => o.visible);
    assert.ok(visible.length > 0, "floor hits should visibly throw small wet droplets");
    assert.equal(effects.root.children.length, initialCount, "painting must reuse the fixed pool");
    for (const object of visible) assert.equal(((object as Mesh).material as MeshBasicMaterial).color.getHex(), 0x1977bd);
    effects.update(null, 1);
    assert.equal(effects.root.children.filter(o => o.visible).length, 0);
  } finally { effects.dispose(); }
});
