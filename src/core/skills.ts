import { classes } from "../content";
import type { Runtime, ActorRuntime } from "./runtime";
import { v, aim, add, sub, norm, dot, distance, mul } from "./math";
import { paintHit } from "./combat";
import { applyDamage } from "./damage";
export type SkillBehavior = (rt: Runtime, state: ActorRuntime) => void;
export const skillBehaviors = new Map<string, SkillBehavior>([
  [
    "dash",
    (rt, s) => {
      s.status.dashUntil = rt.time + 0.2;
      s.actor.skillUntil = rt.time + 2;
      const i = s.input;
      const direction =
        Math.hypot(i.moveX, i.moveZ) > 0.01
          ? norm(
              v(
                Math.cos(i.yaw) * i.moveX - Math.sin(i.yaw) * i.moveZ,
                0,
                -Math.sin(i.yaw) * i.moveX - Math.cos(i.yaw) * i.moveZ,
              ),
            )
          : aim(i.yaw, 0);
      s.status.dashX = direction.x;
      s.status.dashZ = direction.z;
    },
  ],
  [
    "shield",
    (rt, s) => {
      s.actor.skillUntil = s.status.shieldUntil = rt.time + 5;
      s.actor.hp = Math.min(
        s.actor.maxHp,
        s.actor.hp + rt.effect(s.actor, "shieldheal"),
      );
    },
  ],
  [
    "scan",
    (rt, s) => {
      s.actor.skillUntil = rt.time + 5 + rt.effect(s.actor, "scanlong");
      for (const { actor: t } of rt.actors.values())
        if (t.teamId !== s.actor.teamId && distance(s.actor.pos, t.pos) < 24)
          t.markedUntil = s.actor.skillUntil;
    },
  ],
  [
    "bloom",
    (rt, s) => {
      const a = s.actor,
        o = add(a.pos, v(0, 1.3, 0));
      a.protectedUntil = 0;
      a.skillUntil = rt.time + 0.5;
      for (let k = 0; k < 32; k++) {
        const angle = (k * Math.PI * 2) / 32,
          dir = norm(v(Math.cos(angle), -0.28, Math.sin(angle)));
        const h = rt.world.ray(o, dir, 7);
        if (h)
          paintHit(
            rt,
            h.point,
            h.normal,
            h.surfaceId,
            2.2 * (1 + rt.effect(a, "paint")),
            a.teamId,
            a.color,
          );
      }
      for (const { actor: t } of rt.actors.values())
        if (
          t.teamId !== a.teamId &&
          distance(t.pos, a.pos) < 6 &&
          rt.world.visible(o, add(t.pos, v(0, 1, 0)))
        )
          applyDamage(rt, t, a, rt.solo ? 70 : 25, t.pos, a.color);
    },
  ],
]);
export function updateSkills(rt: Runtime, s: ActorRuntime) {
  const a = s.actor,
    c = classes[a.classId];
  if (s.input.skill && a.skillCooldown <= rt.time) {
    const behavior = skillBehaviors.get(c.skill);
    if (behavior) {
      behavior(rt, s);
      a.skillCooldown =
        rt.time +
        c.skillCooldown *
          Math.max(0.25, 1 - rt.effect(a, "cooldown")) *
          (1 - rt.effect(a, "dashchain"));
      rt.emit({
        type: "skill",
        actorId: a.id,
        pos: { ...a.pos },
        color: a.color,
        text: c.skillName,
      });
    }
  }
  if (s.input.grapple && a.grappleCooldown <= rt.time) {
    const origin = add(a.pos, v(0, 1.62, 0)),
      forward = aim(a.yaw, a.pitch);
    const candidates = rt.map.anchors
      .filter(
        (p) =>
          distance(p, origin) < 30 &&
          dot(norm(sub(p, origin)), forward) > 0.82 &&
          rt.world.visible(origin, p),
      )
      .sort((a, b) => distance(a, origin) - distance(b, origin));
    const enemy = rt.solo
      ? [...rt.actors.values()]
          .map((e) => e.actor)
          .find(
            (e) =>
              e.kind === "enemy" &&
              e.alive &&
              distance(e.pos, origin) < 20 &&
              dot(norm(sub(add(e.pos, v(0, 1, 0)), origin)), forward) > 0.95 &&
              rt.world.visible(origin, add(e.pos, v(0, 1, 0))),
          )
      : undefined;
    if (enemy) {
      enemy.vel = mul(norm(sub(a.pos, enemy.pos)), 20);
      enemy.vel.y = 5;
      a.grappleCooldown =
        rt.time + 5 * Math.max(0.2, 1 - rt.effect(a, "grapple"));
      rt.emit({
        type: "grapple",
        actorId: a.id,
        pos: origin,
        to: { ...enemy.pos },
        color: a.color,
      });
    } else if (candidates[0]) {
      s.status.grappleUntil = rt.time + 0.45;
      s.status.grappleX = candidates[0].x;
      s.status.grappleY = candidates[0].y;
      s.status.grappleZ = candidates[0].z;
      a.grappleCooldown =
        rt.time + 5 * Math.max(0.2, 1 - rt.effect(a, "grapple"));
      rt.emit({
        type: "grapple",
        actorId: a.id,
        pos: origin,
        to: candidates[0],
        color: a.color,
      });
    }
  }
}
