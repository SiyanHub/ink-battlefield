import type { ActorSnapshot } from "./contracts";

/** Shared dimensions in metres, relative to the actor's feet. Used by meshes and hit tests. */
export function actorGeometry(actor: Pick<ActorSnapshot, "kind" | "radius">) {
  const enemy = actor.kind === "enemy";
  const horizontalScale = enemy ? actor.radius / 0.42 : 1;
  const heightScale = enemy
    ? Math.min(1.9, Math.max(0.8, actor.radius / 0.42))
    : 1;
  return {
    horizontalScale,
    heightScale,
    headHeight: 1.52 * heightScale,
    // Broad bosses gain shoulder mass, not a disproportionately inflated head.
    headRadius: (enemy ? 0.22 : 0.20) * heightScale,
    bodyHeight: 0.98 * heightScale,
    bodyRadius: Math.max(0.6, actor.radius),
  };
}
