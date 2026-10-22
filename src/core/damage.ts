import type { ActorSnapshot, Vec3 } from "../shared/contracts";
import type { Runtime } from "./runtime";
import { add, sub, norm, dot, mul, aim } from "./math";
export function applyDamage(
  rt: Runtime,
  target: ActorSnapshot,
  source: ActorSnapshot | null,
  amount: number,
  point: Vec3,
  color: number,
  melee = false,
  impact?: { weaponId?: string; normal?: Vec3 },
) {
  if (
    !target.alive ||
    target.protectedUntil > rt.time ||
    (source && target.teamId === source.teamId)
  )
    return;
  if ((rt.actors.get(target.id)?.status.shieldUntil ?? 0) > rt.time && source) {
    const facing = aim(target.yaw, 0),
      to = norm(sub(source.pos, target.pos));
    if (dot(facing, to) > -0.15 - rt.effect(target, "shieldwide")) return;
  }
  if (
    target.weaponId === "katana" &&
    rt.actors.get(target.id)?.input.secondary &&
    source
  ) {
    const to = norm(sub(source.pos, target.pos));
    if (dot(aim(target.yaw, 0), to) > 0.3 - rt.effect(target, "parry"))
      amount *= 0.18;
  }
  const state = rt.actors.get(target.id);
  if (state) state.lastDamage = rt.time;
  target.hp = Math.max(0, target.hp - amount);
  target.tint = color;
  rt.emit({
    type: "hit",
    actorId: source?.id,
    targetId: target.id,
    pos: point,
    amount,
    color,
    ...impact,
  });
  if (
    source &&
    rt.effect(source, "markdamage") &&
    target.markedUntil &&
    target.markedUntil > rt.time
  )
    target.hp = Math.max(
      0,
      target.hp - amount * rt.effect(source, "markdamage"),
    );
  if (target.hp > 0) return;
  target.alive = false;
  target.deaths++;
  target.respawnAt = rt.time + 5;
  target.vel = { x: 0, y: 0, z: 0 };
  if (source) {
    source.kills++;
    const ammo = source.ammo[source.weaponId],
      w = rt.weapons[source.weaponId];
    if (ammo && w)
      ammo.clip = Math.min(
        Math.ceil(w.capacity * (1 + rt.effect(source, "magazine"))),
        ammo.clip + rt.effect(source, "recycle"),
      );
    if (rt.solo)
      source.hp = Math.min(
        source.maxHp,
        source.hp +
          3 +
          rt.effect(source, "supply") +
          (melee ? rt.effect(source, "vampire") : 0),
      );
  }
  rt.emit({
    type: "death",
    actorId: source?.id,
    targetId: target.id,
    pos: add(target.pos, { x: 0, y: 1, z: 0 }),
    color,
    ...impact,
  });
  rt.onDeath(target, source);
  // Body ink falls onto actual geometry; wall hit must not paint an occluded floor.
  const floor = rt.world.ray(
    add(target.pos, { x: 0, y: 1, z: 0 }),
    { x: 0, y: -1, z: 0 },
    4,
  );
  if (floor) {
    const cells = rt.paint.stamp(
      floor.surfaceId,
      floor.point,
      target.radius + 1,
      source?.teamId ?? target.teamId,
      color,
    );
    if (cells.length)
      rt.emit({ type: "paint", surfaceId: floor.surfaceId, cells });
  }
}
export function knockback(
  actor: ActorSnapshot,
  direction: Vec3,
  strength: number,
) {
  actor.vel = add(actor.vel, mul(norm(direction), strength));
}
