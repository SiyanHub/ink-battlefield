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
  lockTarget(s: ActorRuntime, target: Vec3): Vec3 {
    let locked = target;
    const definition = this.rt.enemies[s.actor.enemyId!];
    s.status.diveLocked = 0;
    if (definition.behavior === "boss-flight" && (s.status.attackCycle ?? 0) % 3 === 0) {
      const floor = this.rt.world.ray(add(target, v(0, 5, 0)), v(0, -1, 0), 10);
      if (floor) { locked = floor.point; s.status.diveLocked = 1; }
    }
    s.status.targetX = locked.x;
    s.status.targetY = locked.y;
    s.status.targetZ = locked.z;
    return { ...locked };
  }
  updateRush(s: ActorRuntime, player: ActorSnapshot, device?: DefenseTarget) {
    const rt = this.rt, a = s.actor;
    if ((s.status.rushUntil ?? 0) <= rt.time || s.status.rushHit) return;
    const target = device?.position ?? player.pos;
    if (distance(a.pos, target) > (device ? 1.4 : a.radius + player.radius + .2) ||
      !rt.world.visible(add(a.pos, v(0, 1, 0)), add(target, v(0, 1, 0)))) return;
    s.status.rushHit = 1;
    const damage = rt.enemies[a.enemyId!].damage;
    if (device) device.damage(damage);
    else applyDamage(rt, player, a, damage, player.pos, a.color, true);
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
    if (d.behavior === "rush") {
      const direction = norm(v(s.status.targetX - a.pos.x, 0, s.status.targetZ - a.pos.z));
      s.status.rushX = direction.x;
      s.status.rushZ = direction.z;
      s.status.rushUntil = rt.time + .42;
      s.status.recoverUntil = s.status.rushUntil + .75;
      s.status.rushHit = 0;
      return;
    }
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
        const floor = s.status.diveLocked
          ? rt.world.ray(add(locked, v(0, .2, 0)), v(0, -1, 0), .4)
          : rt.world.ray(add(locked, v(0, 5, 0)), v(0, -1, 0), 10);
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
