import type { Vec3 } from "../shared/contracts";
import type { Runtime } from "./runtime";
import { spawnEnemy } from "./actors";

/** Static targets retain normal enemy health and collision, without an AI controller. */
export class PracticeTargets {
  private targets = new Map<string, { enemyId: string; spawn: Vec3 }>();
  constructor(private rt: Runtime) {}

  add(enemyId: string, spawn: Vec3) {
    const target = spawnEnemy(this.rt, enemyId, spawn);
    // The practice lane starts south of all three paper targets.
    target.yaw = Math.PI;
    this.targets.set(target.id, { enemyId, spawn: { ...spawn } });
    return target.id;
  }

  update() {
    for (const [id, definition] of this.targets) {
      const actor = this.rt.actors.get(id)?.actor;
      if (!actor || actor.alive || this.rt.time < actor.respawnAt) continue;
      this.rt.actors.delete(id);
      this.targets.delete(id);
      this.add(definition.enemyId, definition.spawn);
    }
  }
}
