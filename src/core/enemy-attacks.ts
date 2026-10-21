import type { ActorSnapshot, Vec3 } from "../shared/contracts";
import type { Runtime, ActorRuntime } from "./runtime";
import { v, add, sub, mul, norm, distance } from "./math";
import { applyDamage } from "./damage";
import { weaponBehaviors, paintHit } from "./combat";
import { spawnEnemy } from "./actors";
export interface DefenseTarget {
  position: Vec3;
  damage(amount: number): void;
  alive(): boolean;
}
/** Telegraph wording and attack resolution share the same enemy behavior and cycle. */
export class EnemyAttacks {
  constructor(private rt: Runtime) {}
  warning(s: ActorRuntime) {
    const n = (s.status.attackCycle ?? 0) % 3;
    const b = this.rt.enemies[s.actor.enemyId!].behavior;
    return b === "boss-charge"
      ? ["冲锋！避开直线", "横扫！拉开距离", "震地！远离圆心"][n]
      : b === "boss-flight"
        ? ["俯冲！保持移动", "羽刃扇射", "回旋弹幕"][n]
        : ["墨潮轰击", "召唤纸兵", "环形弹幕"][n];
  }
  private bolt(a: ActorSnapshot, target: Vec3, damage: number, yawOffset = 0) {
    const rt = this.rt,
      o = add(a.pos, v(0, a.radius > 1 ? 2 : 1.2, 0)),
      base = norm(sub(target, o)),
      angle = Math.atan2(-base.x, -base.z) + yawOffset,
      dir = v(
        -Math.sin(angle) * Math.hypot(base.x, base.z),
        base.y,
        -Math.cos(angle) * Math.hypot(base.x, base.z),
      );
    weaponBehaviors.get("projectile")!({
      rt,
      actor: a,
      weapon: { ...rt.weapons.pencil, range: 65, speed: 20, paintRadius: 1 },
      origin: o,
      direction: dir,
      damage,
      color: a.color,
      power: 1,
    });
  }
  perform(
    s: ActorRuntime,
    player: ActorSnapshot,
    target: Vec3,
    device?: DefenseTarget,
  ) {
    const rt = this.rt,
      a = s.actor,
      d = rt.enemies[a.enemyId!],
      center = add(a.pos, v(0, 1.2, 0));
    if (device) {
      if (
        distance(a.pos, device.position) < d.range + 1 &&
        rt.world.visible(center, add(device.position, v(0, 1, 0)))
      )
        device.damage(d.damage);
      return;
    }
    if (d.boss) {
      const cycle = (s.status.attackCycle ?? 0) % 3;
      s.status.attackCycle = (s.status.attackCycle ?? 0) + 1;
      const locked = v(s.status.targetX, s.status.targetY, s.status.targetZ);
      if (d.behavior === "boss-charge" && cycle === 0) {
        const dir = norm(sub(locked, center));
        for (let step = 0; step < 20; step++) {
          a.vel = mul(v(dir.x, 0, dir.z), 28);
          rt.world.move(a, 1 / 60);
          if (distance(a.pos, player.pos) < 2.5) {
            applyDamage(rt, player, a, d.damage, player.pos, a.color);
            break;
          }
        }
      } else if (d.behavior === "boss-charge") {
        const radius = cycle === 1 ? 6 : 8;
        if (
          distance(a.pos, player.pos) < radius &&
          rt.world.visible(center, add(player.pos, v(0, 1, 0)))
        )
          applyDamage(rt, player, a, d.damage, player.pos, a.color);
      } else if (d.behavior === "boss-flight" && cycle === 0) {
        const origin = add(locked, v(0, 5, 0)),
          floor = rt.world.ray(origin, v(0, -1, 0), 10);
        if (floor) {
          a.pos = { ...floor.point };
          if (distance(player.pos, floor.point) < 3.2)
            applyDamage(rt, player, a, d.damage, player.pos, a.color);
          paintHit(
            rt,
            floor.point,
            floor.normal,
            floor.surfaceId,
            3,
            "enemy",
            a.color,
          );
        }
      } else if (d.behavior === "boss-summon" && cycle === 1) {
        if (
          [...rt.actors.values()].filter(
            (e) => e.actor.alive && e.actor.kind === "enemy",
          ).length < 16
        )
          for (let k = 0; k < 3; k++)
            spawnEnemy(
              rt,
              ["grunt", "rusher", "marksman"][k],
              rt.map.enemySpawns[k],
            );
      } else {
        const count = cycle === 2 ? 12 : 5;
        for (let k = 0; k < count; k++)
          this.bolt(
            a,
            target,
            d.damage,
            cycle === 2
              ? (k * Math.PI * 2) / count
              : (k - (count - 1) / 2) * 0.15,
          );
      }
      rt.emit({
        type: "skill",
        actorId: a.id,
        pos: { ...a.pos },
        color: a.color,
        text: a.telegraph,
      });
      return;
    }
    if (["ranged", "paint", "fly"].includes(d.behavior))
      this.bolt(a, target, d.damage);
    else if (
      distance(a.pos, player.pos) < d.range + 1 &&
      rt.world.visible(center, add(player.pos, v(0, 1, 0)))
    )
      applyDamage(rt, player, a, d.damage, player.pos, a.color, true);
  }
}
