import type { ActorSnapshot, MapDefinition, Vec3 } from "../shared/contracts";
import { neutralInput } from "../shared/contracts";
import { weapons } from "../content";
import { Navigation } from "./navigation";
import { World } from "./world";
import { distance, rng } from "./math";
import type { Simulation } from "./simulation";

interface BotPlan {
  id: string;
  seq: number;
  goal: Vec3 | null;
  goalUntil: number;
  lastPosition: Vec3 | null;
  stuckFor: number;
  visited: Map<number, number>;
}

/** A local input producer. Bots obey the same movement, ammunition, damage and paint rules as humans. */
export class TurfBots {
  private readonly world: World;
  private readonly navigation: Navigation;
  private readonly random: () => number;
  private readonly plans: BotPlan[];
  private ticks = 0;

  constructor(private readonly simulation: Simulation, map: MapDefinition, ids: string[], seed: number) {
    this.world = new World(map);
    this.navigation = new Navigation(this.world);
    this.random = rng(seed);
    this.plans = ids.map(id => ({ id, seq: 0, goal: null, goalUntil: 0, lastPosition: null, stuckFor: 0, visited: new Map() }));
  }

  update() {
    // Snapshotting and route decisions run at 10Hz; held controls execute at the normal 60Hz.
    if (++this.ticks % 6 !== 1) return;
    const snapshot = this.simulation.getSnapshot(false), time = snapshot.time;
    for (const [index, plan] of this.plans.entries()) {
      const self = snapshot.actors.find(actor => actor.id === plan.id);
      if (!self?.alive) { plan.goal = null; plan.lastPosition = null; plan.stuckFor = 0; continue; }
      if (plan.lastPosition) {
        const moved = Math.hypot(self.pos.x - plan.lastPosition.x, self.pos.z - plan.lastPosition.z);
        plan.stuckFor = moved < .06 ? plan.stuckFor + .1 : 0;
      }
      plan.lastPosition = { ...self.pos };
      if (!plan.goal || time >= plan.goalUntil || distance(self.pos, plan.goal) < 1.7 || plan.stuckFor > 1.5) {
        this.pickGoal(plan, self, time);
        plan.stuckFor = 0;
      }
      let next = this.navigation.next(plan.id, self.pos, plan.goal!, time);
      if (Math.hypot(next.x - self.pos.x, next.z - self.pos.z) < .3 && distance(self.pos, plan.goal!) > 2) {
        this.pickGoal(plan, self, time);
        next = this.navigation.next(plan.id, self.pos, plan.goal!, time);
      }
      const dx = next.x - self.pos.x, dz = next.z - self.pos.z, length = Math.hypot(dx, dz) || 1;
      const input = { ...neutralInput(), seq: ++plan.seq, yaw: Math.atan2(-dx, -dz), pitch: .95 };
      const target = snapshot.actors.filter(actor => actor.alive && actor.teamId !== self.teamId &&
        distance(actor.pos, self.pos) < 17 && this.world.visible(
          { ...self.pos, y: self.pos.y + 1.62 }, { ...actor.pos, y: actor.pos.y + 1.1 },
        )).sort((a, b) => distance(a.pos, self.pos) - distance(b.pos, self.pos))[0];
      const fighting = target && (distance(target.pos, self.pos) < 5 || Math.floor(time + index * 2) % 8 < 4);
      let slot = 2;
      if (fighting) {
        const rangedSlot = self.weapons.findIndex(id => !!id && !weapons[id].melee &&
          ((self.ammo[id]?.clip ?? 0) > 0 || (self.ammo[id]?.reserve ?? 0) > 0));
        if (rangedSlot >= 0) slot = rangedSlot;
        const tx = target.pos.x - self.pos.x, tz = target.pos.z - self.pos.z;
        input.yaw = Math.atan2(-tx, -tz) + Math.sin(time * 1.6 + index) * .045;
        input.pitch = Math.atan2(self.pos.y + 1.62 - target.pos.y - 1.1, Math.hypot(tx, tz));
      }
      const weapon = weapons[self.weapons[slot]], ammo = self.ammo[weapon.id];
      input.slot = slot;
      input.primary = weapon.automatic || plan.seq % 2 === 1;
      if (fighting && weapon.melee && distance(target.pos, self.pos) > weapon.range) input.primary = false;
      input.reload = !weapon.melee && ammo.clip <= Math.max(1, Math.floor(weapon.capacity * .15)) && ammo.reserve > 0;
      input.moveX = (Math.cos(input.yaw) * dx - Math.sin(input.yaw) * dz) / length * .75;
      input.moveZ = (-Math.sin(input.yaw) * dx - Math.cos(input.yaw) * dz) / length * .75;
      input.jump = self.grounded && plan.stuckFor > .6;
      input.skill = self.classId === "artist" && self.skillCooldown <= time;
      this.simulation.input(plan.id, input);
    }
  }

  private pickGoal(plan: BotPlan, self: ActorSnapshot, time: number) {
    let chosen = -1, best = Infinity;
    for (const [index, point] of this.navigation.points.entries()) {
      const span = distance(point, self.pos);
      if (span < 5 || span > 22) continue;
      const floor = this.world.floor(point, self.radius, .46);
      if (floor === null || Math.abs(floor - point.y) > .5) continue;
      const score = (plan.visited.get(index) ?? 0) * 4 + span * .035 + this.random() * 2;
      if (score < best) { best = score; chosen = index; }
    }
    if (chosen < 0) {
      plan.goal = { ...this.world.map.spawns[plan.seq % this.world.map.spawns.length] };
    } else {
      plan.goal = { ...this.navigation.points[chosen] };
      plan.visited.set(chosen, (plan.visited.get(chosen) ?? 0) + 1);
    }
    plan.goalUntil = time + 7;
    this.navigation.remove(plan.id);
  }
}
