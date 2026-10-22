import type { WeaponDefinition } from "../shared/contracts";

export function aimingView(weapon: WeaponDefinition | undefined, held: boolean, active: boolean): {mode: "hip" | "sights" | "scope" | "focus"; fov: number} {
  if (!active || !held || !weapon || weapon.melee) return {mode: "hip", fov: 74};
  if (weapon.model === "sniper") return {mode: "scope", fov: 26};
  if (["rifle", "smg", "carbine", "lmg", "shotgun", "revolver", "grenade"].includes(weapon.model)) return {mode: "sights", fov: 55};
  return {mode: "focus", fov: 62};
}

export function menuTransition(
  open: boolean,
  online: boolean,
): {
  open: boolean;
  command: "pause" | "resume" | null;
} {
  return { open: !open, command: online ? null : open ? "resume" : "pause" };
}
export function resultTitle(
  phase: string,
  winner: string | null,
  team: string | undefined,
  online: boolean,
) {
  if (!online)
    return phase === "victory" ? "这一页，属于你。" : "再画一次，也很好。";
  if (winner === null) return "平局 · 各有千秋。";
  return winner === team ? "这一页，属于你。" : "胜负留待下一页。";
}
export function overlayFor(
  phase: string,
  alive: boolean,
  online: boolean,
  menuOpen: boolean,
): "results" | "upgrade" | "respawn" | "pause" | "none" {
  if (phase === "victory" || phase === "defeat") return "results";
  if (phase === "upgrade") return "upgrade";
  if (menuOpen || phase === "paused") return "pause";
  if (!alive && online) return "respawn";
  return "none";
}
import type { PaintSnapshot, PaintSurfaceSnapshot } from "../shared/contracts";
import type { MapDefinition, Vec3 } from "../shared/contracts";
import { World } from "../core/world";
export function floorOwnership(
  map: MapDefinition,
  paint: PaintSnapshot,
  feet: Vec3,
): string | null {
  const hit = new World(map).ray(
    { ...feet, y: feet.y + 0.15 },
    { x: 0, y: -1, z: 0 },
    2,
  );
  if (!hit) return null;
  const s = map.surfaces.find((s) => s.id === hit.surfaceId && s.scoring);
  if (!s) return null;
  const d = {
    x: hit.point.x - s.center.x,
    y: hit.point.y - s.center.y,
    z: hit.point.z - s.center.z,
  };
  const col = Math.floor(
    (d.x * s.u.x + d.y * s.u.y + d.z * s.u.z + s.width / 2) / s.cellSize,
  );
  const row = Math.floor(
    (d.x * s.v.x + d.y * s.v.y + d.z * s.v.z + s.height / 2) / s.cellSize,
  );
  const index = row * Math.ceil(s.width / s.cellSize) + col;
  return (
    paint.surfaces
      .find((p) => p.id === s.id)
      ?.cells.find((c) => c[0] === index)?.[2] ?? null
  );
}
/** Full authoritative snapshots: omitted surfaces are clean, not unchanged. */
export class PaintPresentation {
  private revisions = new Map<string, number>();
  reset() {
    this.revisions.clear();
  }
  apply(snapshot: PaintSnapshot): Map<string, PaintSurfaceSnapshot | null> {
    const changes = new Map<string, PaintSurfaceSnapshot | null>();
    const present = new Set(snapshot.surfaces.map((s) => s.id));
    for (const id of this.revisions.keys())
      if (!present.has(id)) {
        changes.set(id, null);
        this.revisions.delete(id);
      }
    for (const surface of snapshot.surfaces)
      if (this.revisions.get(surface.id) !== surface.revision) {
        changes.set(surface.id, surface);
        this.revisions.set(surface.id, surface.revision);
      }
    return changes;
  }
}
export class TeamSelection {
  value = "blue";
  private initialized = false;
  initialize(team: string | undefined) {
    if (!this.initialized && (team === "red" || team === "blue")) {
      this.value = team;
      this.initialized = true;
    }
  }
  choose(team: string) {
    this.value = team;
    this.initialized = true;
  }
}
export function spectatorPosition(
  pos: {
    x: number;
    y: number;
    z: number;
  },
  yaw: number,
  forward: number,
  strafe: number,
  vertical: number,
  dt: number,
) {
  const speed = 6 * dt;
  return {
    x: pos.x + (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed,
    y: pos.y + vertical * speed,
    z: pos.z + (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * speed,
  };
}
export function cycleEquipmentSlot(
  current: number,
  direction: 1 | -1,
  available: number[],
): number | null {
  for (let step = 1; step <= 3; step++) {
    const next = (current + direction * step + 6) % 3;
    if (available.includes(next)) return next;
  }
  return null;
}
