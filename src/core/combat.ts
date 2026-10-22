import { actorGeometry } from "../shared/actor-geometry";
import type {
  ActorSnapshot,
  Vec3,
  WeaponDefinition,
} from "../shared/contracts";
import type { Runtime, ActorRuntime, ProjectileRuntime } from "./runtime";
import { v, add, sub, mul, norm, aim, distance, dot, clamp } from "./math";
import { raySphere } from "./world";
import { applyDamage, knockback } from "./damage";
export interface ShotContext {
  rt: Runtime;
  actor: ActorSnapshot;
  weapon: WeaponDefinition;
  origin: Vec3;
  direction: Vec3;
  damage: number;
  color: number;
  power: number;
}
export type WeaponBehavior = (shot: ShotContext) => void;
export const weaponBehaviors = new Map<string, WeaponBehavior>();
export function paintHit(
  rt: Runtime,
  point: Vec3,
  normal: Vec3,
  surfaceId: string,
  radius: number,
  owner: string,
  color: number,
) {
  const cells = rt.paint.stamp(surfaceId, point, radius, owner, color);
  if (cells.length)
    rt.emit({ type: "paint", surfaceId, cells, pos: point, normal, color });
}
export function traceShot(
  s: ShotContext,
  dir = s.direction,
  penetration = 0,
  ricochet = false,
) {
  // Keep the extension API; former instant traces now launch swept physical ink.
  launch({ ...s, direction: dir }, {
    penetration,
    ricochets: ricochet ? 1 : 0,
    headMultiplier: 1.5 + s.rt.effect(s.actor, "weakpoint"),
  });
}
weaponBehaviors.set("hitscan", (s) =>
  traceShot(
    s,
    s.direction,
    s.rt.effect(s.actor, "pierce"),
    s.rt.effect(s.actor, "ricochet") > 0,
  ),
);
weaponBehaviors.set("burst", (s) => traceShot(s));
function volley(s: ShotContext, count: number) {
  let launched = false;
  for (let j = 0; j < count; j++) {
    const direction = norm(add(s.direction, v(
      (s.rt.random() - 0.5) * s.weapon.spread,
      (s.rt.random() - 0.5) * s.weapon.spread,
      (s.rt.random() - 0.5) * s.weapon.spread,
    )));
    launched = !!launch({ ...s, direction }, {
      headMultiplier: 1.5 + s.rt.effect(s.actor, "weakpoint"), emitShot: false,
    }) || launched;
  }
  if (launched) muzzle(s);
}
weaponBehaviors.set("pellets", s => volley(s, s.weapon.pellets ?? 1));
weaponBehaviors.set("spray", s => volley(s, (s.weapon.pellets ?? 1) + s.rt.effect(s.actor, "spraywide")));
function melee(s: ShotContext) {
  const { rt, actor, weapon } = s;
  for (const { actor: target } of rt.actors.values()) {
    if (
      target.id === actor.id ||
      target.teamId === actor.teamId ||
      !target.alive
    )
      continue;
    const center = add(target.pos, v(0, 1, 0)),
      d = sub(center, s.origin);
    if (
      distance(s.origin, center) <= weapon.range + target.radius &&
      dot(norm(d), s.direction) > 0.25 &&
      rt.world.visible(s.origin, center)
    ) {
      applyDamage(rt, target, actor, s.damage, center, s.color, true, { weaponId: weapon.id, normal: mul(s.direction, -1) });
      if (weapon.knockback) knockback(target, s.direction, weapon.knockback);
    }
  }
  const floor = rt.world.ray(
    add(add(actor.pos, v(0, 0.6, 0)), mul(aim(actor.yaw, 0), 1.5)),
    v(0, -1, 0),
    2,
  );
  const wall = rt.world.ray(s.origin, s.direction, weapon.range);
  for (const hit of [wall, floor])
    if (hit)
      paintHit(
        rt,
        hit.point,
        hit.normal,
        hit.surfaceId,
        weapon.paintRadius * (1 + rt.effect(actor, "paint")),
        actor.teamId,
        s.color,
      );
  rt.emit({
    type: "shot",
    actorId: actor.id,
    weaponId: weapon.id,
    pos: s.origin,
    to: add(s.origin, mul(s.direction, weapon.range)),
    color: s.color,
  });
}
weaponBehaviors.set("melee", melee);
weaponBehaviors.set("roller", melee);
function muzzle(s: ShotContext) {
  s.rt.emit({ type: "shot", actorId: s.actor.id, weaponId: s.weapon.id,
    pos: { ...s.origin }, to: add(s.origin, mul(s.direction, 2)), color: s.color });
}
function defaultSpeed(w: WeaponDefinition) {
  if (w.behavior === "spray") return 45;
  if (w.behavior === "pellets") return 70;
  if (w.behavior === "beam") return 150;
  if (w.model === "sniper") return 180;
  if (w.model === "revolver") return 120;
  if (w.model === "smg") return 85;
  return w.behavior === "hitscan" || w.behavior === "burst" ? 95 : 45;
}
function launch(s: ShotContext, options: { penetration?: number; ricochets?: number; headMultiplier?: number; emitShot?: boolean } = {}) {
  const { rt, actor, weapon: w } = s;
  if (rt.projectiles.size >= 384) return;
  const id = `projectile-${++rt.serial}`,
    speed = (w.speed ?? defaultSpeed(w)) * (w.charge ? 0.65 + 0.35 * s.power : 1);
  rt.projectiles.set(id, {
    snapshot: {
      id,
      ownerId: actor.id,
      teamId: actor.teamId,
      pos: { ...s.origin },
      vel: mul(s.direction, speed),
      color: s.color,
      radius: w.projectileRadius ?? (w.splash ? 0.2 : w.behavior === "spray" ? 0.09 : w.behavior === "beam" ? 0.08 : 0.055),
      weaponId: w.id,
    },
    damage: s.damage * (w.charge ? 0.3 + 0.7 * s.power : 1),
    gravity: w.gravity ?? 0,
    expires: rt.time + Math.min(5, w.range / Math.max(1, speed) + 1),
    splash: w.splash ?? 0,
    paintRadius: w.paintRadius * (1 + rt.effect(actor, "paint")),
    cluster: rt.effect(actor, "cluster") > 0,
    remainingRange: w.range,
    penetration: Math.max(0, Math.floor(options.penetration ?? 0)),
    ricochets: options.ricochets ?? 0,
    hitActors: new Set(),
    headMultiplier: options.headMultiplier ?? 1,
    blockAllies: actor.kind === "player",
  });
  const projectile = rt.projectiles.get(id)!.snapshot;
  rt.emit({ type: "projectile", projectile: { ...projectile, pos: { ...projectile.pos }, vel: { ...projectile.vel } } });
  if (options.emitShot !== false) muzzle(s);
  return id;
}
weaponBehaviors.set("projectile", s => { launch(s); });
weaponBehaviors.set("charge", s => { launch(s); });
weaponBehaviors.set("beam", (s) =>
  traceShot(
    s,
    s.direction,
    1 + s.rt.effect(s.actor, "penpierce"),
  ),
);
function shoot(
  rt: Runtime,
  state: ActorRuntime,
  w: WeaponDefinition,
  power = 1,
) {
  const a = state.actor,
    ammo = a.ammo[w.id],
    behavior = weaponBehaviors.get(w.behavior);
  if (!behavior || !ammo || (!w.melee && ammo.clip <= 0)) return false;
  const capacity = Math.ceil(w.capacity * (1 + rt.effect(a, "magazine"))),
    damage =
      (rt.solo ? w.damage : w.pvpDamage) *
      (1 + rt.effect(a, "damage")) *
      (ammo.clip === capacity ? 1 + rt.effect(a, "opening") : 1);
  if (!w.melee) ammo.clip--;
  ammo.nextFireAt =
    rt.time +
    w.interval *
      (a.skillUntil > rt.time
        ? Math.max(0.5, 1 - rt.effect(a, "dashfire"))
        : 1);
  a.protectedUntil = 0;
  const spread =
    w.spread *
    Math.max(0.1, 1 - rt.effect(a, "spread")) *
    (state.input.secondary ? 0.35 : 1);
  const direction = norm(
    add(
      aim(a.yaw, a.pitch),
      v(
        (rt.random() - 0.5) * spread,
        (rt.random() - 0.5) * spread,
        (rt.random() - 0.5) * spread,
      ),
    ),
  );
  behavior({
    rt,
    actor: a,
    weapon: w,
    origin: add(a.pos, v(0, 1.62, 0)),
    direction,
    damage,
    color: a.color,
    power,
  });
  return true;
}
export function updateWeapon(rt: Runtime, state: ActorRuntime) {
  const a = state.actor,
    i = state.input;
  if (!a.alive) return;
  if (
    i.slot !== null &&
    Number.isInteger(i.slot) &&
    a.weapons[i.slot] &&
    a.weapons[i.slot] !== a.weaponId
  ) {
    const previous = a.ammo[a.weaponId];
    if (previous) {
      previous.reloadUntil = 0;
      previous.chargeStarted = null;
    }
    a.weaponId = a.weapons[i.slot];
    state.burstLeft = 0;
    state.lastPrimary = i.primary;
    a.ammo[a.weaponId].nextFireAt = rt.time + 0.22;
  }
  const w = rt.weapons[a.weaponId];
  if (!w) return;
  const ammo = a.ammo[w.id];
  if (!ammo) return;
  const capacity = Math.ceil(w.capacity * (1 + rt.effect(a, "magazine")));
  if (ammo.reloadUntil && rt.time >= ammo.reloadUntil) {
    const n = Math.min(capacity - ammo.clip, ammo.reserve);
    ammo.clip += n;
    ammo.reserve -= n;
    ammo.reloadUntil = 0;
  }
  if (
    i.reload &&
    !w.melee &&
    ammo.clip < capacity &&
    ammo.reserve > 0 &&
    !ammo.reloadUntil
  ) {
    ammo.reloadUntil =
      rt.time + w.reload * Math.max(0.4, 1 - rt.effect(a, "reload"));
    rt.emit({ type: "sound", actorId: a.id, text: "reload" });
  }
  if (ammo.reloadUntil || (state.status.shieldUntil ?? 0) > rt.time) {
    state.lastPrimary = i.primary;
    return;
  }
  if (w.charge) {
    if (
      i.primary &&
      ammo.chargeStarted === null &&
      rt.time >= ammo.nextFireAt &&
      ammo.clip > 0
    )
      ammo.chargeStarted = rt.time;
    if (!i.primary && ammo.chargeStarted !== null) {
      const duration =
        w.charge * Math.max(0.3, 1 - rt.effect(a, "quickcharge"));
      shoot(
        rt,
        state,
        w,
        clamp((rt.time - ammo.chargeStarted) / duration, 0.1, 1),
      );
      ammo.chargeStarted = null;
    }
    state.lastPrimary = i.primary;
    return;
  }
  if (state.burstLeft > 0 && rt.time >= state.burstAt) {
    if (shoot(rt, state, w)) {
      state.burstLeft--;
      state.burstAt = rt.time + 0.08;
    } else state.burstLeft = 0;
  }
  const shouldFire =
    i.primary && (w.automatic || !state.lastPrimary) && state.burstLeft === 0;
  if (shouldFire && rt.time >= ammo.nextFireAt) {
    if (!w.melee && ammo.clip <= 0) {
      if (ammo.reserve > 0) ammo.reloadUntil = rt.time + w.reload;
      state.lastPrimary = i.primary;
      return;
    }
    if (shoot(rt, state, w) && w.burst) {
      state.burstLeft = w.burst - 1;
      state.burstAt = rt.time + 0.08;
    }
  }
  state.lastPrimary = i.primary;
}
function explode(rt: Runtime, p: ProjectileRuntime, point: Vec3, dir: Vec3, directId?: string) {
  if (!p.splash) return;
  const q = p.snapshot, source = rt.actors.get(q.ownerId)?.actor ?? null;
  if (source)
    for (const { actor: target } of rt.actors.values()) {
      if (target.id === directId || target.teamId === q.teamId || !target.alive) continue;
      const center = add(target.pos, v(0, 1, 0)), d = distance(center, point);
      if (d < p.splash && rt.world.visible(add(point, mul(dir, -0.05)), center))
        applyDamage(rt, target, source, p.damage * (1 - d / p.splash), point, q.color, false,
          { weaponId: q.weaponId, normal: norm(sub(point, center)) });
    }
  const floor = rt.world.ray(add(point, v(0, 0.1, 0)), v(0, -1, 0), 6);
  if (floor)
    paintHit(rt, floor.point, floor.normal, floor.surfaceId, p.paintRadius, q.teamId, q.color);
  rt.emit({ type: "skill", pos: point, color: q.color, weaponId: q.weaponId, text: "爆破" });
  if (p.cluster && source)
    for (let k = 0; k < 3; k++) {
      const angle = k * Math.PI * 2 / 3;
      const id = launch({ rt, actor: source,
        weapon: { ...rt.weapons.grenade, id: "grenade", speed: 9, gravity: 12, splash: 1.5, paintRadius: 1 },
        origin: add(point, v(0, 0.4, 0)), direction: norm(v(Math.cos(angle), 1, Math.sin(angle))),
        damage: p.damage * 0.2, color: q.color, power: 1,
      }, { emitShot: false });
      if (id) rt.projectiles.get(id)!.cluster = false;
    }
}

function sphereContact(origin: Vec3, dir: Vec3, center: Vec3, radius: number, limit: number) {
  // Muzzles and moving actors can overlap between ticks. An inside start is
  // already a contact, not a negative ray entry to discard.
  return distance(origin, center) <= radius ? 0 : raySphere(origin, dir, center, radius, limit);
}

function finishProjectile(rt: Runtime, id: string, point: Vec3) {
  rt.emit({ type: "projectile-end", projectileId: id, pos: { ...point } });
  rt.projectiles.delete(id);
}

export function updateProjectiles(rt: Runtime, dt: number) {
  // Children emitted by an impact start next tick; iterating the live Map would
  // grant them a second frame's travel within their parent's collision step.
  for (const [id, p] of [...rt.projectiles]) {
    const q = p.snapshot;
    if (rt.time >= p.expires || p.remainingRange <= 1e-7) { finishProjectile(rt, id, q.pos); continue; }
    q.vel.y -= p.gravity * dt;
    let travel = Math.min(distance(v(), q.vel) * dt, p.remainingRange);
    while (travel > 1e-7 && rt.projectiles.has(id)) {
      const dir = norm(q.vel), wall = rt.world.ray(q.pos, dir, travel), limit = wall?.distance ?? travel;
      const hits: { actor: ActorSnapshot; distance: number; head: boolean }[] = [];
      for (const { actor: target } of rt.actors.values()) {
        if (!target.alive || target.id === q.ownerId || p.hitActors.has(target.id) ||
          (!p.blockAllies && target.teamId === q.teamId)) continue;
        const geometry = actorGeometry(target);
        const body = sphereContact(q.pos, dir, add(target.pos, v(0, geometry.bodyHeight, 0)), geometry.bodyRadius, limit);
        // Broad torso proxies overlap the neck. Classify the precise head along
        // this contact path, independent of where the 60 Hz segment ends, while
        // still applying damage only at the earliest contact inside this step.
        const head = sphereContact(q.pos, dir, add(target.pos, v(0, geometry.headHeight, 0)), geometry.headRadius,
          Math.min(p.remainingRange, limit + 2 * (geometry.bodyRadius + geometry.headRadius)));
        const headInStep = head !== null && head <= limit;
        if (headInStep || body !== null)
          hits.push({ actor: target, distance: Math.min(body ?? Infinity, headInStep ? head! : Infinity),
            head: head !== null && (headInStep || !rt.world.ray(q.pos, dir, head)) });
      }
      hits.sort((a, b) => a.distance - b.distance);
      for (const hit of hits) {
        const point = add(q.pos, mul(dir, hit.distance));
        if (hit.actor.teamId === q.teamId) {
          explode(rt, p, point, dir, hit.actor.id);
          finishProjectile(rt, id, point);
          break;
        }
        p.hitActors.add(hit.actor.id);
        const source = rt.actors.get(q.ownerId)?.actor ?? null;
        if (source)
          applyDamage(rt, hit.actor, source, p.damage * (hit.head ? p.headMultiplier : 1), point, q.color, false,
            { weaponId: q.weaponId, normal: mul(dir, -1) });
        if (p.splash || p.penetration <= 0) {
          explode(rt, p, point, dir, hit.actor.id);
          finishProjectile(rt, id, point);
          break;
        }
        p.penetration--;
      }
      if (!rt.projectiles.has(id)) break;
      if (wall) {
        paintHit(rt, wall.point, wall.normal, wall.surfaceId, p.paintRadius, q.teamId, q.color);
        explode(rt, p, wall.point, dir);
        if (p.ricochets > 0 && !p.splash) {
          p.ricochets--; p.penetration = 0; p.damage *= 0.6;
          p.remainingRange -= wall.distance; travel -= wall.distance;
          q.pos = add(wall.point, mul(wall.normal, 0.04));
          q.vel = sub(q.vel, mul(wall.normal, 2 * dot(q.vel, wall.normal)));
          continue;
        }
        finishProjectile(rt, id, wall.point);
        break;
      }
      q.pos = add(q.pos, mul(dir, travel));
      p.remainingRange -= travel;
      if (p.remainingRange <= 1e-7) finishProjectile(rt, id, q.pos);
      break;
    }
  }
}
