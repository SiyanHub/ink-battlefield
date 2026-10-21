import type { ActorSnapshot, ClassId, Vec3 } from "../shared/contracts";
import { neutralInput } from "../shared/contracts";
import { classes, getLoadout } from "../content";
import type { Runtime, ActorRuntime } from "./runtime";
import { v } from "./math";
export function createPlayer(
  rt: Runtime,
  id: string,
  name: string,
  classId: ClassId,
  requested: string[],
  teamId: string,
  spawn: Vec3,
): ActorRuntime {
  const c = classes[classId],
    selected = getLoadout(classId, requested),
    loadout = selected.length === 2 ? [selected[0], "", selected[1]] : selected,
    ammo: ActorSnapshot["ammo"] = {};
  for (const weaponId of loadout) {
    const w = rt.weapons[weaponId];
    if (w)
      ammo[weaponId] = {
        clip: w.capacity,
        reserve: w.capacity * 6,
        reloadUntil: 0,
        nextFireAt: 0,
        chargeStarted: null,
      };
  }
  const actor: ActorSnapshot = {
    id,
    name,
    kind: "player",
    classId,
    teamId,
    pos: { ...spawn },
    vel: v(),
    yaw: spawn.z < 0 ? Math.PI : 0,
    pitch: 0,
    radius: 0.42,
    hp: 100,
    maxHp: 100,
    alive: true,
    grounded: true,
    respawnAt: 0,
    protectedUntil: rt.time + 1.5,
    skillUntil: 0,
    skillCooldown: 0,
    grappleCooldown: 0,
    weaponId: loadout[0],
    weapons: loadout,
    ammo,
    kills: 0,
    deaths: 0,
    upgrades: [],
    color: c.color,
    tint: 0,
  };
  return {
    actor,
    input: neutralInput(),
    lastPrimary: false,
    lastDamage: 0,
    airJumped: false,
    lastSeq: -1,
    processedSeq: -1,
    attackAt: rt.time + 1,
    pendingAttack: null,
    burstLeft: 0,
    burstAt: 0,
    status: {},
  };
}
export function spawnEnemy(
  rt: Runtime,
  enemyId: string,
  pos: Vec3,
): ActorSnapshot {
  const d = rt.enemies[enemyId];
  const state = createPlayer(
      rt,
      `enemy-${++rt.serial}`,
      d.name,
      "assault",
      ["rifle"],
      "enemy",
      pos,
    ),
    a = state.actor;
  Object.assign(a, {
    kind: "enemy",
    enemyId,
    hp: d.hp,
    maxHp: d.hp,
    radius: d.radius,
    protectedUntil: 0,
    color: d.color,
    weapons: [],
    weaponId: "",
    ammo: {},
  });
  rt.actors.set(a.id, state);
  rt.emit({ type: "spawn", actorId: a.id, pos: { ...pos }, color: d.color });
  return a;
}
