import type {
  ActorSnapshot,
  BoxDefinition,
  MapDefinition,
  Vec3,
  InputFrame,
} from "../shared/contracts";
import { v, add, sub, mul, dot, length, norm, clamp } from "./math";
export interface WorldHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  surfaceId: string;
}
export function rayBox(
  origin: Vec3,
  dir: Vec3,
  b: BoxDefinition,
  max: number,
): WorldHit | null {
  let near = -Infinity,
    far = Infinity,
    normal = v(),
    exit = v();
  for (const axis of ["x", "y", "z"] as const) {
    const min = b.center[axis] - b.size[axis] / 2,
      maxB = b.center[axis] + b.size[axis] / 2;
    if (Math.abs(dir[axis]) < 1e-8) {
      if (origin[axis] < min || origin[axis] > maxB) return null;
      continue;
    }
    let a = (min - origin[axis]) / dir[axis],
      z = (maxB - origin[axis]) / dir[axis];
    const sign = dir[axis] > 0 ? -1 : 1;
    if (a > z) [a, z] = [z, a];
    if (a > near) {
      near = a;
      normal = v();
      normal[axis] = sign;
    }
    if (z < far) {
      far = z;
      exit = v();
      exit[axis] = -sign;
    }
    if (near > far) return null;
  }
  let t = near;
  if (t < 0.0001) {
    t = far;
    normal = exit;
  }
  if (t < 0.0001 || t > max) return null;
  const face =
    normal.y > 0
      ? "top"
      : normal.y < 0
        ? "bottom"
        : normal.x > 0
          ? "east"
          : normal.x < 0
            ? "west"
            : normal.z > 0
              ? "south"
              : "north";
  return {
    distance: t,
    point: add(origin, mul(dir, t)),
    normal,
    surfaceId: `${b.id}:${face}`,
  };
}
export function raySphere(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radius: number,
  max: number,
): number | null {
  const delta = sub(origin, center),
    b = dot(delta, dir),
    c = dot(delta, delta) - radius * radius,
    disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= max ? t : null;
}
export class World {
  constructor(readonly map: MapDefinition) {}
  ray(origin: Vec3, dir: Vec3, max = 200): WorldHit | null {
    let closest: WorldHit | null = null;
    for (const b of this.map.boxes) {
      const h = rayBox(origin, dir, b, closest?.distance ?? max);
      if (h) closest = h;
    }
    return closest;
  }
  visible(a: Vec3, b: Vec3): boolean {
    const d = sub(b, a);
    return !this.ray(a, norm(d), Math.max(0, length(d) - 0.08));
  }
  blocked(pos: Vec3, radius = 0.42, height = 1.8, allowStep = false): boolean {
    return this.map.boxes.some((b) => {
      const low = b.center.y - b.size.y / 2,
        top = b.center.y + b.size.y / 2;
      if (pos.y + 0.06 >= top || pos.y + height <= low) return false;
      if (allowStep && top <= pos.y + 0.46) return false;
      const x = clamp(
          pos.x,
          b.center.x - b.size.x / 2,
          b.center.x + b.size.x / 2,
        ),
        z = clamp(pos.z, b.center.z - b.size.z / 2, b.center.z + b.size.z / 2);
      return (x - pos.x) ** 2 + (z - pos.z) ** 2 < radius * radius;
    });
  }
  floor(pos: Vec3, radius = 0.4, rise = 0.46): number | null {
    let floor: number | null = null;
    for (const b of this.map.boxes) {
      const top = b.center.y + b.size.y / 2;
      if (top > pos.y + rise) continue;
      const x = clamp(
          pos.x,
          b.center.x - b.size.x / 2,
          b.center.x + b.size.x / 2,
        ),
        z = clamp(pos.z, b.center.z - b.size.z / 2, b.center.z + b.size.z / 2);
      if ((x - pos.x) ** 2 + (z - pos.z) ** 2 >= radius * radius) continue;
      if (floor === null || top > floor) floor = top;
    }
    return floor;
  }
  move(actor: ActorSnapshot, dt: number) {
    const steps = Math.max(
      1,
      Math.ceil((Math.hypot(actor.vel.x, actor.vel.z) * dt) / 0.14),
    );
    for (let i = 0; i < steps; i++)
      for (const axis of ["x", "z"] as const) {
        const next = {
          ...actor.pos,
          [axis]: actor.pos[axis] + (actor.vel[axis] * dt) / steps,
        };
        if (!this.blocked(next, actor.radius, 1.8, actor.grounded)) {
          actor.pos = next;
          if (actor.grounded) {
            const f = this.floor(actor.pos, actor.radius);
            if (f !== null && f > actor.pos.y) actor.pos.y = f;
          }
        } else actor.vel[axis] = 0;
      }
    const nextY = actor.pos.y + actor.vel.y * dt;
    const f = this.floor(
      actor.pos,
      actor.radius,
      Math.max(0.46, -actor.vel.y * dt + 0.05),
    );
    if (actor.vel.y <= 0 && f !== null && nextY <= f) {
      actor.pos.y = f;
      actor.vel.y = 0;
      actor.grounded = true;
    } else {
      const candidate = { ...actor.pos, y: nextY };
      if (actor.vel.y > 0 && this.blocked(candidate, actor.radius)) {
        actor.vel.y = 0;
      } else actor.pos.y = nextY;
      actor.grounded = false;
    }
  }
}
export function movePlayer(
  actor: ActorSnapshot,
  input: InputFrame,
  world: World,
  dt: number,
  speedFactor = 1,
  airFactor = 1,
) {
  const factor = Math.max(1, Math.hypot(input.moveX, input.moveZ)),
    mx = input.moveX / factor,
    mz = input.moveZ / factor,
    speed = (input.sprint ? 9.6 : 6.4) * speedFactor;
  const tx = (Math.cos(input.yaw) * mx - Math.sin(input.yaw) * mz) * speed,
    tz = (-Math.sin(input.yaw) * mx - Math.cos(input.yaw) * mz) * speed;
  const blend = 1 - Math.exp(-(actor.grounded ? 16 : 5 * airFactor) * dt);
  actor.vel.x += (tx - actor.vel.x) * blend;
  actor.vel.z += (tz - actor.vel.z) * blend;
  actor.vel.y -= 26 * dt;
  if (input.jump && actor.grounded) {
    actor.vel.y = 8.2;
    actor.grounded = false;
  }
  actor.yaw = input.yaw;
  actor.pitch = input.pitch;
  world.move(actor, dt);
}
