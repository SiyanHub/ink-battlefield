import type { ActorSnapshot, ObjectiveSnapshot } from "../shared/contracts";
import type { Runtime } from "./runtime";

/** Disposable per-run milestones; completing one never gates another. */
export interface PracticeGuide {
  targetKills: number;
  paintComplete: boolean;
  skillComplete: boolean;
  coverage: number;
  lastEventId: number;
}

export function createPracticeGuide(): PracticeGuide {
  return { targetKills: 0, paintComplete: false, skillComplete: false, coverage: 0, lastEventId: -1 };
}

export function recordPracticeDeath(rt: Runtime, guide: PracticeGuide, target: ActorSnapshot, source: ActorSnapshot | null) {
  const player = [...rt.actors.values()].find(({ actor }) => actor.kind === "player")?.actor;
  if (player && target.kind === "enemy" && source?.id === player.id)
    guide.targetKills = Math.min(3, guide.targetKills + 1);
}

export function updatePracticeGuide(rt: Runtime, guide: PracticeGuide, objective: ObjectiveSnapshot) {
  const player = [...rt.actors.values()].find(({ actor }) => actor.kind === "player")?.actor;
  if (!player) return;
  // Cooldown is set by updateSkills only after a skill behavior succeeds.
  guide.skillComplete ||= player.skillCooldown > 0;
  // Observe before takeFrame drains events; avoid recounting every floor cell on idle ticks.
  if (!guide.paintComplete && (guide.lastEventId < 0 || rt.events.some(
    (event) => event.id > guide.lastEventId && event.type === "paint",
  ))) {
    guide.coverage = rt.paint.coverage()[player.teamId] ?? 0;
    guide.paintComplete = guide.coverage >= 1;
  }
  guide.lastEventId = rt.serial;
  objective.progress = Number(guide.targetKills >= 3) + Number(guide.paintComplete) + Number(guide.skillComplete);
  const remaining: string[] = [];
  if (guide.targetKills < 3) remaining.push(`左键击倒纸靶 ${guide.targetKills}/3`);
  if (!guide.paintComplete) remaining.push(`向地面射击染色 ${(Math.floor(guide.coverage * 10) / 10).toFixed(1)}/1%`);
  if (!guide.skillComplete) remaining.push("E 释放职业技能");
  objective.description = remaining.length
    ? `顺序不限 · ${remaining.join(" · ")}`
    : "三项练习已完成 · 继续自由试笔 · Esc 暂停可重置场地与补给";
}
