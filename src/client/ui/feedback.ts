import type { GameFrame } from "../../shared/contracts";

export interface BattleFeedbackView {
  hit: boolean;
  damage: number;
  damageLethal: boolean;
  lethal: boolean;
  hurt: boolean;
  reduceMotion: boolean;
  kills: string[];
  reload: { weaponId: string; start: number; until: number } | null;
}

/** Bounded presentation state. Session-scoped event IDs reject replayed network frames. */
export class BattleFeedback {
  private lastEvent = -1;
  private hitUntil = 0;
  private damageUntil = 0;
  private damage = 0;
  private damageTarget = "";
  private lethalUntil = 0;
  private lethalTarget = "";
  private hurtUntil = 0;
  private kills: { name: string; until: number }[] = [];
  private reload: BattleFeedbackView["reload"] = null;
  private snapshotTime = -1;

  reset() {
    this.lastEvent = -1;
    this.hitUntil = 0;
    this.damageUntil = this.damage = this.lethalUntil = 0;
    this.damageTarget = "";
    this.lethalTarget = "";
    this.hurtUntil = 0;
    this.kills = [];
    this.reload = null;
    this.snapshotTime = -1;
  }

  apply(frame: GameFrame, playerId: string, now = performance.now() / 1000) {
    const { snapshot } = frame;
    // A new local encounter can rewind simulation time within the same session.
    if (snapshot.time < this.snapshotTime) {
      this.hitUntil = this.hurtUntil = 0;
      this.damageUntil = this.damage = this.lethalUntil = 0;
      this.damageTarget = "";
      this.lethalTarget = "";
      this.kills = [];
      this.reload = null;
    }
    this.snapshotTime = snapshot.time;
    const player = snapshot.actors.find(actor => actor.id === playerId);
    const until = player?.ammo[player.weaponId]?.reloadUntil ?? 0;
    if (player?.alive && until > snapshot.time) {
      if (this.reload?.weaponId !== player.weaponId || this.reload.until !== until)
        this.reload = { weaponId: player.weaponId, start: snapshot.time, until };
    } else this.reload = null;
    for (const event of [...frame.events].sort((a, b) => a.id - b.id)) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (event.type === "hit" && event.targetId === playerId) this.hurtUntil = now + .6;
      if (event.actorId !== playerId || event.targetId === playerId) continue;
      if (event.type === "hit") {
        this.hitUntil = now + .24;
        if (now > this.damageUntil || this.damageTarget !== event.targetId) this.damage = 0;
        this.damageTarget = event.targetId ?? "";
        this.damage += Number.isFinite(event.amount) ? Math.max(0, event.amount!) : 0;
        this.damageUntil = now + .55;
      }
      if (event.type === "death") {
        this.lethalUntil = now + .4;
        this.lethalTarget = event.targetId ?? "";
        const name = frame.snapshot.actors.find(actor => actor.id === event.targetId)?.name ?? "目标";
        this.kills = [...this.kills.filter(item => item.until > now), { name, until: now + 2.4 }].slice(-3);
      }
    }
  }

  view(now = performance.now() / 1000, reduceMotion = false): BattleFeedbackView {
    return { hurt: now < this.hurtUntil, reduceMotion, hit: now < this.hitUntil, damage: now < this.damageUntil ? Math.round(this.damage) : 0, damageLethal: now < this.lethalUntil && this.damageTarget === this.lethalTarget, lethal: now < this.lethalUntil, kills: this.kills.filter(item => item.until > now).map(item => item.name), reload: this.reload ? { ...this.reload } : null };
  }
}
