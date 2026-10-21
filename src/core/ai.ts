import type { Runtime } from "./runtime";
import { Navigation } from "./navigation";
import { v, add, norm, distance } from "./math";
import { applyDamage } from "./damage";
import { paintHit } from "./combat";
import { EnemyAttacks, type DefenseTarget } from "./enemy-attacks";
export type { DefenseTarget } from "./enemy-attacks";
export class EnemyAI {
  private navigation: Navigation;
  private attacks: EnemyAttacks;
  constructor(private rt: Runtime) {
    this.navigation = new Navigation(rt.world);
    this.attacks = new EnemyAttacks(rt);
  }
  update(dt: number, device?: DefenseTarget) {
    const rt = this.rt,
      player = [...rt.actors.values()].find(
        (s) => s.actor.kind === "player" && s.actor.alive,
      )?.actor;
    if (!player) return;
    for (const s of [...rt.actors.values()]) {
      const a = s.actor;
      if (a.kind !== "enemy") continue;
      if (!a.alive) {
        if (rt.time > a.respawnAt) {
          rt.actors.delete(a.id);
          this.navigation.remove(a.id);
        }
        continue;
      }
      const d = rt.enemies[a.enemyId!];
      if (!d) continue;
      const attackDevice =
        !!device &&
        device.alive() &&
        distance(a.pos, device.position) < distance(a.pos, player.pos) * 1.5 &&
        !d.boss;
      const goal = attackDevice ? device!.position : player.pos;
      const center = add(a.pos, v(0, d.radius > 1 ? 2.2 : 1.2, 0)),
        target = add(goal, v(0, 1, 0));
      a.yaw = Math.atan2(-(goal.x - a.pos.x), -(goal.z - a.pos.z));
      if (s.pendingAttack && rt.time >= (a.telegraphUntil ?? 0)) {
        this.attacks.perform(s, player, target, attackDevice ? device : undefined);
        s.pendingAttack = null;
        a.telegraph = undefined;
        s.attackAt =
          rt.time + d.interval * (d.boss && a.hp < a.maxHp * 0.5 ? 0.65 : 1);
      }
      const flying = d.behavior === "fly" || d.behavior === "boss-flight";
      const dist = distance(a.pos, goal);
      const ranged = [
        "ranged",
        "paint",
        "fly",
        "boss-flight",
        "boss-summon",
      ].includes(d.behavior);
      if (!s.pendingAttack) {
        const desired = ranged ? Math.min(d.range * 0.55, 12) : d.range * 0.8;
        if (dist > desired || !rt.world.visible(center, target)) {
          const next = flying
              ? goal
              : this.navigation.next(a.id, a.pos, goal, rt.time),
            direction = norm(v(next.x - a.pos.x, 0, next.z - a.pos.z));
          let speed = d.speed * (d.boss && a.hp < a.maxHp * 0.5 ? 1.25 : 1);
          a.vel.x += (direction.x * speed - a.vel.x) * Math.min(1, dt * 5);
          a.vel.z += (direction.z * speed - a.vel.z) * Math.min(1, dt * 5);
        } else {
          a.vel.x *= 0.82;
          a.vel.z *= 0.82;
        }
      } else {
        a.vel.x *= 0.7;
        a.vel.z *= 0.7;
      }
      if (flying) {
        a.vel.y = 0;
        const ground = rt.world.floor({ ...a.pos, y: 15 }, a.radius, 0) ?? 0;
        a.pos.y +=
          (ground + 3 + Math.sin(rt.time * 1.5) * 0.5 - a.pos.y) *
          Math.min(1, dt * 2);
      } else a.vel.y -= 26 * dt;
      rt.world.move(a, dt);
      if (
        rt.time >= s.attackAt &&
        !s.pendingAttack &&
        dist < d.range + 1 &&
        rt.world.visible(center, target)
      ) {
        s.pendingAttack = d.behavior;
        s.status.targetX = target.x;
        s.status.targetY = target.y;
        s.status.targetZ = target.z;
        a.telegraph = d.boss ? this.attacks.warning(s) : ranged ? "瞄准" : "挥击";
        a.telegraphUntil = rt.time + (d.boss ? 1.05 : ranged ? 0.65 : 0.45);
        rt.emit({
          type: "telegraph",
          actorId: a.id,
          pos: { ...target },
          color: a.color,
          text: a.telegraph,
        });
      }
      if (d.behavior === "paint" && rt.tick % 45 === 0) {
        const h = rt.world.ray(add(a.pos, v(0, 1, 0)), v(0, -1, 0), 3);
        if (h)
          paintHit(rt, h.point, h.normal, h.surfaceId, 1.4, "enemy", a.color);
      }
      if (a.pos.y < -8) applyDamage(rt, a, player, 99999, a.pos, player.color);
    }
  }
}
