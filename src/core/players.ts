import type { ClassId, InputFrame, Vec3 } from "../shared/contracts";
import { neutralInput } from "../shared/contracts";
import { classes } from "../content";
import type { Runtime, ActorRuntime } from "./runtime";
import { createPlayer } from "./actors";
import { movePlayer } from "./world";
import { updateWeapon } from "./combat";
import { clamp, v, mul, norm, sub } from "./math";
import { updateSkills } from "./skills";
import { applyDamage } from "./damage";

/** Player authority owns input latching, movement and replacement on respawn. */
export class PlayerSystem {
  constructor(private rt: Runtime, private upgrades: string[] = []) {}
  addPlayer(
    id: string,
    name: string,
    classId: ClassId,
    loadout: string[] = [],
    teamId = id,
    spawn?: Vec3,
  ) {
    if (!classes[classId] || this.rt.actors.has(id)) return;
    const state = createPlayer(
      this.rt,
      id,
      name,
      classId,
      loadout,
      teamId,
      spawn ??
        this.rt.map.spawns[this.rt.actors.size % this.rt.map.spawns.length],
    );
    state.actor.upgrades = [...this.upgrades];
    for (const [id, ammo] of Object.entries(state.actor.ammo))
      ammo.clip = Math.ceil(
        this.rt.weapons[id].capacity *
          (1 + this.rt.effect(state.actor, "magazine")),
      );
    state.actor.hp = state.actor.maxHp =
      100 + this.rt.effect(state.actor, "health");
    this.rt.actors.set(id, state);
  }
  input(id: string, input: InputFrame) {
    const s = this.rt.actors.get(id);
    if (!s || !Number.isInteger(input.seq) || input.seq <= s.lastSeq) return;
    if (
      ![input.moveX, input.moveZ, input.yaw, input.pitch].every(Number.isFinite)
    )
      return;
    s.lastSeq = input.seq;
    s.input = {
      ...neutralInput(),
      ...input,
      moveX: clamp(input.moveX, -1, 1),
      moveZ: clamp(input.moveZ, -1, 1),
      pitch: clamp(input.pitch, -1.5, 1.5),
      jump: input.jump || s.input.jump,
      reload: input.reload || s.input.reload,
      skill: input.skill || s.input.skill,
      grapple: input.grapple || s.input.grapple,
      slot: input.slot ?? s.input.slot,
    };
  }
  requestRespawn(id: string, classId?: ClassId, weapons?: string[]) {
    const state = this.rt.actors.get(id);
    if (!this.rt.solo && state && !state.actor.alive && classId && classes[classId]) {
      state.pendingClass = classId;
      state.pendingWeapons = weapons;
    }
  }

  update(dt: number) {
    for (const state of [...this.rt.actors.values()]) {
      if (state.actor.kind !== "player") continue;
      if (state.actor.alive) this.updateAlive(state, dt);
      else if (!this.rt.solo && this.rt.time >= state.actor.respawnAt)
        this.respawn(state);
    }
  }

  private respawn(state: ActorRuntime) {
    const rt = this.rt, a = state.actor;
    const opponents = [...rt.actors.values()]
      .filter((s) => s.actor.alive && s.actor.teamId !== a.teamId)
      .map((s) => s.actor);
    const spawn = [...rt.map.spawns].sort(
      (x, y) =>
        Math.min(
          ...opponents.map((p) =>
            Math.hypot(y.x - p.pos.x, y.z - p.pos.z),
          ),
          100,
        ) -
        Math.min(
          ...opponents.map((p) =>
            Math.hypot(x.x - p.pos.x, x.z - p.pos.z),
          ),
          100,
        ),
    )[0];
    const next = createPlayer(
      rt,
      a.id,
      a.name,
      (state.pendingClass ?? a.classId) as ClassId,
      state.pendingWeapons ?? a.weapons,
      a.teamId,
      spawn,
    );
    next.actor.kills = a.kills;
    next.actor.deaths = a.deaths;
    next.lastSeq = state.lastSeq;
    next.processedSeq = state.processedSeq;
    rt.actors.set(a.id, next);
    rt.emit({ type: "spawn", actorId: a.id, pos: spawn });
  }

  private updateAlive(state: ActorRuntime, dt: number) {
    const rt = this.rt, a = state.actor;
    updateSkills(rt, state);
    if (a.grounded) state.airJumped = false;
    else if (
      state.input.jump &&
      rt.effect(a, "doublejump") &&
      !state.airJumped
    ) {
      a.vel.y = 8.2;
      state.airJumped = true;
    }
    if (state.status.grappleUntil > rt.time) {
      a.vel = mul(
        norm(
          sub(
            v(
              state.status.grappleX,
              state.status.grappleY,
              state.status.grappleZ,
            ),
            a.pos,
          ),
        ),
        19,
      );
      rt.world.move(a, dt);
    } else if (state.status.dashUntil > rt.time) {
      a.vel = mul(v(state.status.dashX, 0, state.status.dashZ), 28);
      rt.world.move(a, dt);
    } else
      movePlayer(
        a,
        state.input,
        rt.world,
        dt,
        1 +
          rt.effect(a, "speed") +
          (a.weaponId === "roller" ? rt.effect(a, "rollrush") : 0),
        1 + rt.effect(a, "air"),
      );
    updateWeapon(rt, state);
    state.processedSeq = state.lastSeq;
    if (a.pos.y < -8) applyDamage(rt, a, null, 9999, a.pos, a.color);
    if (rt.solo && rt.time - state.lastDamage > 6)
      a.hp = Math.min(a.maxHp, a.hp + 3 * dt);
    state.input = {
      ...state.input,
      jump: false,
      reload: false,
      skill: false,
      grapple: false,
      slot: null,
    };
  }
}
