import { actorGeometry } from "../shared/actor-geometry";
import type {
  ActorSnapshot,
  Vec3,
  WeaponDefinition,
} from "../shared/contracts";
import type { Runtime, ActorRuntime } from "./runtime";
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
const palette = [
  0xe55282, 0x4e9be1, 0xe8b537, 0x45b7a1, 0x9c73d6, 0xf18c44, 0x69bade,
];
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
  const { rt, actor, weapon, origin, color } = s;
  const wall = rt.world.ray(origin, dir, weapon.range);
  let max = wall?.distance ?? weapon.range;
  const hits: { a: ActorSnapshot; t: number; head: boolean }[] = [];
  for (const state of rt.actors.values()) {
    const a = state.actor;
    if (!a.alive || a.id === actor.id || a.teamId === actor.teamId) continue;
    const geometry = actorGeometry(a);
    const head = raySphere(
      origin,
      dir,
      add(a.pos, v(0, geometry.headHeight, 0)),
      geometry.headRadius,
      max,
    );
    const body = raySphere(
      origin,
      dir,
      add(a.pos, v(0, geometry.bodyHeight, 0)),
      geometry.bodyRadius,
      max,
    );
    if (head !== null || body !== null)
      hits.push({
        a,
        t: head ?? body!,
        // Torso proxies deliberately overlap the neck. A line through the
        // precise head must still be a weak-point hit on a broad-shouldered boss.
        head: head !== null,
      });
  }
  hits.sort((a, b) => a.t - b.t);
  for (const h of hits.slice(0, 1 + penetration)) {
    const point = add(origin, mul(dir, h.t));
    applyDamage(
      rt,
      h.a,
      actor,
      s.damage * (h.head ? 1.5 + rt.effect(actor, "weakpoint") : 1),
      point,
      color,
    );
    max = h.t;
  }
  if (wall && hits.length <= penetration) {
    paintHit(
      rt,
      wall.point,
      wall.normal,
      wall.surfaceId,
      weapon.paintRadius * (1 + rt.effect(actor, "paint")),
      actor.teamId,
      color,
    );
    max = wall.distance;
    if (ricochet) {
      const d =
        dir.x * wall.normal.x + dir.y * wall.normal.y + dir.z * wall.normal.z;
      traceShot(
        {
          ...s,
          origin: add(wall.point, mul(wall.normal, 0.04)),
          damage: s.damage * 0.6,
        },
        sub(dir, mul(wall.normal, 2 * d)),
        0,
        false,
      );
    }
  }
  rt.emit({
    type: "shot",
    actorId: actor.id,
    weaponId: weapon.id,
    pos: origin,
    to: add(origin, mul(dir, max)),
    color,
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
weaponBehaviors.set("pellets", (s) => {
  for (let j = 0; j < (s.weapon.pellets ?? 1); j++)
    traceShot(
      s,
      norm(
        add(
          s.direction,
          v(
            (s.rt.random() - 0.5) * s.weapon.spread,
            (s.rt.random() - 0.5) * s.weapon.spread,
            (s.rt.random() - 0.5) * s.weapon.spread,
          ),
        ),
      ),
    );
});
weaponBehaviors.set("spray", (s) => {
  for (
    let j = 0;
    j < (s.weapon.pellets ?? 1) + s.rt.effect(s.actor, "spraywide");
    j++
  )
    traceShot(
      s,
      norm(
        add(
          s.direction,
          v(
            (s.rt.random() - 0.5) * s.weapon.spread,
            (s.rt.random() - 0.5) * s.weapon.spread,
            (s.rt.random() - 0.5) * s.weapon.spread,
          ),
        ),
      ),
    );
});
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
      applyDamage(rt, target, actor, s.damage, center, s.color, true);
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
function launch(s: ShotContext) {
  const { rt, actor, weapon: w } = s;
  if (rt.projectiles.size >= 384) return;
  const id = `projectile-${++rt.serial}`;
  rt.projectiles.set(id, {
    snapshot: {
      id,
      ownerId: actor.id,
      teamId: actor.teamId,
      pos: { ...s.origin },
      vel: mul(s.direction, (w.speed ?? 45) * (0.65 + 0.35 * s.power)),
      color: s.color,
      radius: w.splash ? 0.2 : 0.07,
      weaponId: w.id,
    },
    damage: s.damage * (0.3 + 0.7 * s.power),
    gravity: w.gravity ?? 0,
    expires: rt.time + Math.min(5, w.range / (w.speed ?? 45) + 1),
    splash: w.splash ?? 0,
    paintRadius: w.paintRadius * (1 + rt.effect(actor, "paint")),
    cluster: rt.effect(actor, "cluster") > 0,
  });
  rt.emit({
    type: "shot",
    actorId: actor.id,
    weaponId: w.id,
    pos: s.origin,
    to: add(s.origin, mul(s.direction, 2)),
    color: s.color,
  });
}
weaponBehaviors.set("projectile", launch);
weaponBehaviors.set("charge", launch);
weaponBehaviors.set("beam", (s) =>
  traceShot(
    { ...s, damage: s.damage * (0.3 + 0.7 * s.power) },
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
    color: palette[(rt.tick + palette.length + a.kills) % palette.length],
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
export function updateProjectiles(rt: Runtime, dt: number) {
  for (const [id, p] of rt.projectiles) {
    const q = p.snapshot;
    if (rt.time >= p.expires) {
      rt.projectiles.delete(id);
      continue;
    }
    q.vel.y -= p.gravity * dt;
    const delta = mul(q.vel, dt),
      range = distance(v(), delta),
      dir = norm(delta),
      wall = rt.world.ray(q.pos, dir, range);
    let best = wall?.distance ?? range,
      hit: ActorSnapshot | null = null;
    for (const { actor: a } of rt.actors.values()) {
      if (!a.alive || a.id === q.ownerId || a.teamId === q.teamId) continue;
      const geometry = actorGeometry(a);
      const body = raySphere(
          q.pos,
          dir,
          add(a.pos, v(0, geometry.bodyHeight, 0)),
          geometry.bodyRadius,
          best,
        ),
        head = raySphere(
          q.pos,
          dir,
          add(a.pos, v(0, geometry.headHeight, 0)),
          geometry.headRadius,
          best,
        );
      const d = Math.min(body ?? Infinity, head ?? Infinity);
      if (Number.isFinite(d)) {
        best = d;
        hit = a;
      }
    }
    const point = add(q.pos, mul(dir, best));
    const source = rt.actors.get(q.ownerId)?.actor ?? null;
    if (hit || wall) {
      if (hit && source) applyDamage(rt, hit, source, p.damage, point, q.color);
      if (p.splash && source)
        for (const { actor: a } of rt.actors.values()) {
          if (a.id === hit?.id || a.teamId === source.teamId || !a.alive)
            continue;
          const d = distance(add(a.pos, v(0, 1, 0)), point);
          if (
            d < p.splash &&
            rt.world.visible(
              add(point, mul(dir, -0.05)),
              add(a.pos, v(0, 1, 0)),
            )
          )
            applyDamage(
              rt,
              a,
              source,
              p.damage * (1 - d / p.splash),
              point,
              q.color,
            );
        }
      if (wall)
        paintHit(
          rt,
          wall.point,
          wall.normal,
          wall.surfaceId,
          p.paintRadius,
          q.teamId,
          q.color,
        );
      if (p.splash) {
        const floor = rt.world.ray(add(point, v(0, 0.1, 0)), v(0, -1, 0), 6);
        if (floor)
          paintHit(
            rt,
            floor.point,
            floor.normal,
            floor.surfaceId,
            p.paintRadius,
            q.teamId,
            q.color,
          );
        rt.emit({ type: "skill", pos: point, color: q.color, text: "爆破" });
        if (p.cluster && source) {
          for (let k = 0; k < 3; k++) {
            const angle = (k * Math.PI * 2) / 3;
            launch({
              rt,
              actor: source,
              weapon: {
                ...rt.weapons.grenade,
                id: "grenade",
                speed: 9,
                gravity: 12,
                splash: 1.5,
                paintRadius: 1,
              },
              origin: add(point, v(0, 0.4, 0)),
              direction: norm(v(Math.cos(angle), 1, Math.sin(angle))),
              damage: p.damage * 0.2,
              color: palette[k],
              power: 1,
            });
            const latest = [...rt.projectiles.values()].at(-1);
            if (latest) latest.cluster = false;
          }
        }
      }
      rt.projectiles.delete(id);
    } else q.pos = add(q.pos, delta);
  }
}
