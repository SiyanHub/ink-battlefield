import type { GameFrame, GameSnapshot } from "../../shared/contracts";
import { weapons } from "../../content";

const lessons = [
  ["fire", "开火", "瞄准纸靶，左键开火；右键可瞄准"],
  ["reload", "换弹", "打出一发后按 R，等换弹完成"],
  ["switch", "换画具", "按 2 / 3 或滚轮，换一件画具"],
  ["skill", "职业技能", "按 E，体验职业技能"],
  ["grapple", "钩索", "抬头寻找蓝色圆环，移到无遮挡处瞄准后按 Q"],
] as const;
export interface QuickStartView {
  complete: boolean;
  steps: { id: string; title: string; hint: string; done: boolean }[];
}

/** Optional practice guidance, driven by completed game actions rather than key presses. */
export class QuickStartGuide {
  private active = false;
  private done = new Set<string>();
  private playerId = "";
  private weaponId = "";
  private lastEvent = -1;
  private ammunition: Record<string, { clip: number; reserve: number }> = {};
  reset(snapshot: GameSnapshot, playerId: string, active: boolean) {
    this.active = active; this.playerId = playerId; this.done.clear(); this.lastEvent = -1;
    const player = snapshot.actors.find(actor => actor.id === playerId);
    this.weaponId = player?.weaponId ?? "";
    this.ammunition = structuredClone(player?.ammo ?? {});
  }
  apply(frame: GameFrame) {
    if (!this.active) return;
    const player = frame.snapshot.actors.find(actor => actor.id === this.playerId);
    if (!player) return;
    if (player.weaponId !== this.weaponId) this.done.add("switch");
    this.weaponId = player.weaponId;
    for (const [id, ammo] of Object.entries(player.ammo)) {
      const previous = this.ammunition[id];
      if (previous && ammo.clip > previous.clip && ammo.reserve < previous.reserve) this.done.add("reload");
      this.ammunition[id] = { clip: ammo.clip, reserve: ammo.reserve };
    }
    for (const event of frame.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (event.actorId !== this.playerId) continue;
      if (event.type === "shot") this.done.add("fire");
      if (event.type === "grapple") this.done.add("grapple");
      if (event.type === "skill") this.done.add("skill");
    }
  }
  view(): QuickStartView {
    const weapon = weapons[this.weaponId];
    return {
      complete: lessons.every(([id]) => this.done.has(id)),
      steps: lessons.map(([id, title, hint]) => ({ id, title, done: this.done.has(id),
        hint: id === "fire" && weapon?.charge ? "按住左键蓄力，再松开释放；右键可聚焦" : hint })),
    };
  }
}
