import type {
  CampaignSnapshot,
  ObjectiveSnapshot,
  ActorSnapshot,
} from "../shared/contracts";
import type { Runtime } from "./runtime";
import { spawnEnemy } from "./actors";
import { classes, upgrades } from "../content";
import { upgradeAppliesToWeapon } from "../content/upgrades";
import { rng, distance } from "./math";
import type { DefenseTarget } from "./ai";
export interface CampaignConfig {
  completed: number;
  upgrades: string[];
  duration?: number;
  groups?: number;
}
export class CampaignDirector {
  readonly state: CampaignSnapshot;
  readonly objective: ObjectiveSnapshot;
  finished = false;
  failed = false;
  chosen = false;
  private wave = 0;
  private nextWave = 0.6;
  private clearedAt: number | null = null;
  private totalGroups: number;
  private duration: number;
  private bossId: string | null = null;
  private lastProgress = -1;
  constructor(
    private rt: Runtime,
    readonly config: CampaignConfig,
    seed: number,
  ) {
    const chapter = Math.floor(config.completed / 3),
      encounter = config.completed % 3,
      random = rng(seed + config.completed * 71);
    const kind =
      encounter === 2
        ? "boss"
        : encounter === 0
          ? "clear"
          : random() > 0.5
            ? "paint"
            : "defend";
    this.state = {
      chapter,
      encounter,
      completed: config.completed,
      objectiveKind: kind,
      choices: [],
      seed,
      won: false,
    };
    this.duration = config.duration ?? 132 + chapter * 18;
    this.totalGroups = config.groups ?? 12;
    this.objective = {
      title:
        kind === "boss"
          ? "本章终战"
          : kind === "clear"
            ? "清理失控涂鸦"
            : kind === "paint"
              ? "夺回画页"
              : "守护画心",
      description:
        kind === "boss"
          ? "观察预警，寻找出手时机"
          : kind === "clear"
            ? "守住这页，击败所有来袭纸兵"
            : kind === "paint"
              ? "消灭来袭纸兵，并染色画心区域的65%地板"
              : "阻止纸兵破坏画心，完成防守",
      progress: 0,
      target: kind === "boss" ? 1 : kind === "paint" ? 65 : this.totalGroups * (2 + chapter),
      remaining: kind === "defend" ? this.duration : 0,
      deviceHp: kind === "defend" ? 500 : undefined,
    };
  }
  get defense(): DefenseTarget | undefined {
    if (this.state.objectiveKind !== "defend") return undefined;
    return {
      position: this.rt.map.objectives[0].center,
      alive: () => !this.failed,
      damage: (amount) => {
        this.objective.deviceHp = Math.max(
          0,
          (this.objective.deviceHp ?? 0) - amount,
        );
        if (this.objective.deviceHp <= 0) this.failed = true;
      },
    };
  }
  update() {
    const rt = this.rt,
      player = [...rt.actors.values()].find(
        (s) => s.actor.kind === "player",
      )?.actor;
    if (!player || this.finished || this.failed) return;
    const alive = [...rt.actors.values()].filter(
      (s) => s.actor.kind === "enemy" && s.actor.alive,
    );
    if (this.state.objectiveKind === "boss") {
      if (!this.bossId) {
        const boss = spawnEnemy(
          rt,
          ["doodler", "origami", "maestro"][this.state.chapter],
          rt.map.enemySpawns[0],
        );
        this.bossId = boss.id;
        this.objective.title = boss.name;
        this.objective.target = boss.maxHp;
      }
      const boss = rt.actors.get(this.bossId)?.actor;
      this.objective.progress = boss
        ? boss.maxHp - boss.hp
        : this.objective.target;
      if (boss && !boss.alive) this.finish(player);
      return;
    }
    // Normal clear encounters reward a quick clear with another wave. Explicit
    // duration/groups remain a fixed schedule for authored scenarios and tests.
    if (this.state.objectiveKind === "clear" && this.config.duration === undefined &&
      this.config.groups === undefined && this.wave > 0 && alive.length === 0) {
      this.clearedAt ??= rt.time;
      this.nextWave = Math.min(this.nextWave, this.clearedAt + 2.5);
    } else this.clearedAt = null;
    if (
      this.wave < this.totalGroups &&
      rt.time >= this.nextWave &&
      alive.length < 18
    ) {
      const types = [
        "grunt",
        "rusher",
        "marksman",
        "brute",
        "painter",
        "flyer",
      ];
      const count = 2 + this.state.chapter;
      for (let n = 0; n < count; n++) {
        const type = types[(this.wave + n + this.state.chapter) % types.length];
        const points = [...rt.map.enemySpawns].sort(
          (a, b) => distance(b, player.pos) - distance(a, player.pos),
        );
        const pos = points[(this.wave + n) % Math.min(3, points.length)];
        const enemy = spawnEnemy(rt, type, {
          ...pos,
          x: pos.x + (n - 0.5) * 1.4,
        });
        enemy.hp = enemy.maxHp *= 1 + this.state.chapter * 0.15;
      }
      this.wave++;
      this.nextWave =
        rt.time + this.duration / Math.max(1, this.totalGroups - 1);
    }
    this.objective.remaining = this.state.objectiveKind === "defend" ? Math.max(0, this.duration - rt.time) : 0;
    const remainingEnemies = [...rt.actors.values()].filter(
      (s) => s.actor.kind === "enemy" && s.actor.alive,
    ).length;
    if (this.state.objectiveKind === "paint" && rt.tick - this.lastProgress >= 30) {
      this.lastProgress = rt.tick;
      this.objective.progress = rt.paint.coverage(rt.map.objectives[0])[player.teamId] ?? 0;
    }
    if (this.state.objectiveKind !== "paint")
      this.objective.progress = Math.max(0, this.wave * (2 + this.state.chapter) - remainingEnemies);
    const waveStatus = `已出场 ${this.wave}/${this.totalGroups} 波 · 剩余纸兵 ${remainingEnemies}`;
    this.objective.description = this.state.objectiveKind === "paint"
      ? `画心覆盖 ${Math.floor(this.objective.progress)} / 65% · ${waveStatus}`
      : this.state.objectiveKind === "defend"
        ? `守护画心，击退全部来袭纸兵 · ${waveStatus}`
        : `击败全部纸兵完成 · ${waveStatus}`;
    if (
      this.wave >= this.totalGroups &&
      !remainingEnemies &&
      (this.state.objectiveKind !== "paint" || this.objective.progress >= 65)
    )
      this.finish(player);
  }
  private finish(player: ActorSnapshot) {
    this.finished = true;
    this.state.completed++;
    this.state.won = this.state.completed >= 9;
    if (this.state.won) return;
    const possible = Object.values(upgrades).filter(
      (u) =>
        (u.classId === "all" || u.classId === player.classId) &&
        [...classes[player.classId].weapons, classes[player.classId].melee].some(
          id => upgradeAppliesToWeapon(u.id, this.rt.weapons[id]),
        ) &&
        player.upgrades.filter((id) => id === u.id).length < u.maxStacks,
    );
    for (let i = possible.length - 1; i > 0; i--) {
      const j = Math.floor(this.rt.random() * (i + 1));
      [possible[i], possible[j]] = [possible[j], possible[i]];
    }
    this.state.choices = possible.slice(0, 3).map((u) => u.id);
    this.rt.emit({ type: "stage", text: "这一笔，画得漂亮。" });
  }
  choose(id: string, actor: ActorSnapshot) {
    if (!this.finished || this.chosen || !this.state.choices.includes(id))
      return false;
    actor.upgrades.push(id);
    actor.maxHp = 100 + this.rt.effect(actor, "health");
    actor.hp = actor.maxHp;
    this.chosen = true;
    return true;
  }
}
