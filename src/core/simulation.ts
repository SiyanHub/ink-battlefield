import type {
  ClassId,
  MapDefinition,
  Vec3,
  InputFrame,
  GameSnapshot,
  GameFrame,
  SessionCommand,
  WeaponDefinition,
  EnemyDefinition,
  PaintSnapshot,
} from "../shared/contracts";
import { maps } from "../content";
import { neutralInput } from "../shared/contracts";
import { Runtime } from "./runtime";
import { spawnEnemy } from "./actors";
import { PlayerSystem } from "./players";
import { PracticeTargets } from "./practice-targets";
import { updateProjectiles } from "./combat";
import {
  modeRegistry,
  createModeState,
  updateMode,
  type ModeRules,
  type ModeState,
} from "./modes";
import { EnemyAI } from "./ai";
import { CampaignDirector, type CampaignConfig } from "./campaign";
export interface SimulationOptions {
  modeId: string;
  map?: MapDefinition;
  mapId?: string;
  seed?: number;
  teamMode?: boolean;
  /** Local adapters opt in; an ordinary network simulation continues while menus are open. */
  allowPause?: boolean;
  beforeStep?: (simulation: Simulation) => void;
  content?: {
    weapons?: Record<string, WeaponDefinition>;
    enemies?: Record<string, EnemyDefinition>;
  };
  campaign?: CampaignConfig;
  initialPaint?: PaintSnapshot;
}
export class Simulation {
  readonly rt: Runtime;
  private phase: GameSnapshot["phase"] = "playing";
  private modeId: string;
  private rules: ModeRules;
  private mode: ModeState;
  private players: PlayerSystem;
  private practice: PracticeTargets | null;
  private ai: EnemyAI | null;
  private campaign: CampaignDirector | null;
  constructor(readonly options: SimulationOptions) {
    this.modeId = options.modeId;
    this.rules = modeRegistry.get(options.modeId);
    this.mode = createModeState(this.rules, options.teamMode);
    this.rt = new Runtime(
      options.map ?? maps[options.mapId ?? "construction"],
      options.modeId === "solo",
      options.seed ?? Date.now(),
      options.content,
    );
    this.players = new PlayerSystem(this.rt, options.campaign?.upgrades);
    this.practice = options.modeId === "practice" ? new PracticeTargets(this.rt) : null;
    this.ai = this.rt.solo ? new EnemyAI(this.rt) : null;
    this.campaign = options.campaign
      ? new CampaignDirector(this.rt, options.campaign, options.seed ?? 1)
      : null;
    if (options.initialPaint) this.rt.paint.restore(options.initialPaint);
    this.rt.onDeath = (target, source) => {
      this.rules.onDeath(this.rt, this.mode, target, source);
      if (this.rt.solo && target.kind === "player") this.phase = "defeat";
    };
  }
  addPlayer(id: string, name: string, classId: ClassId, loadout: string[] = [], teamId = id, spawn?: Vec3) {
    this.players.addPlayer(id, name, classId, loadout, teamId, spawn);
  }
  addEnemy(id: string, pos: Vec3) {
    if (this.rt.enemies[id])
      return this.practice?.add(id, pos) ?? spawnEnemy(this.rt, id, pos).id;
    return null;
  }
  removePlayer(id: string) {
    this.rt.actors.delete(id);
  }
  acknowledgedInput(id: string) {
    return this.rt.actors.get(id)?.processedSeq ?? -1;
  }
  input(id: string, input: InputFrame) {
    this.players.input(id, input);
  }
  /** Transport loss cancels held actions without inventing an acknowledged input. */
  releaseInput(id: string) {
    const state = this.rt.actors.get(id);
    if (!state) return;
    state.input = { ...neutralInput(), seq: state.input.seq, yaw: state.input.yaw, pitch: state.input.pitch };
    state.lastPrimary = false;
    state.burstLeft = 0;
    for (const ammo of Object.values(state.actor.ammo)) ammo.chargeStarted = null;
  }
  command(id: string, c: SessionCommand) {
    const s = this.rt.actors.get(id);
    if (!s) return;
    const canPause = this.rt.solo || this.modeId === "practice" || this.options.allowPause === true;
    if (canPause && c.type === "pause" && this.phase === "playing")
      this.phase = "paused";
    if (canPause && c.type === "resume" && this.phase === "paused")
      this.phase = "playing";
    if (c.type === "respawn")
      this.players.requestRespawn(id, c.classId, c.weapons);
    if (this.phase === "upgrade" && c.type === "upgrade" && c.upgradeId)
      this.campaign?.choose(c.upgradeId, s.actor);
  }
  canContinue() {
    return this.phase === "upgrade" && this.campaign?.chosen === true;
  }
  step() {
    if (this.phase !== "playing") return;
    const rt = this.rt,
      dt = 1 / 60;
    rt.tick++;
    rt.time = rt.tick / 60;
    this.options.beforeStep?.(this);
    this.players.update(dt);
    this.campaign?.update();
    this.ai?.update(dt, this.campaign?.defense);
    updateProjectiles(rt, dt);
    this.practice?.update();
    if (this.campaign?.failed) this.phase = "defeat";
    else if (
      this.campaign?.finished &&
      [...rt.actors.values()].some(
        (s) => s.actor.kind === "player" && s.actor.alive,
      )
    )
      this.phase = this.campaign.state.won ? "victory" : "upgrade";
    updateMode(rt, this.rules, this.mode);
    if (this.mode.finished) this.phase = "victory";
  }
  advance(seconds: number) {
    for (let i = 0; i < Math.round(seconds * 60); i++) this.step();
  }
  getSnapshot(includePaint?: true): GameSnapshot;
  getSnapshot(includePaint: false): Omit<GameSnapshot, "paint">;
  getSnapshot(includePaint = true): GameSnapshot | Omit<GameSnapshot, "paint"> {
    const snapshot: Omit<GameSnapshot, "paint"> = {
      tick: this.rt.tick,
      time: this.rt.time,
      phase: this.phase,
      modeId: this.modeId,
      mapId: this.rt.map.id,
      actors: structuredClone([...this.rt.actors.values()].map((s) => s.actor)),
      projectiles: structuredClone(
        [...this.rt.projectiles.values()].map((p) => p.snapshot),
      ),
      scores: { ...this.mode.scores },
      objective: { ...(this.campaign?.objective ?? this.mode.objective) },
      campaign: this.campaign
        ? structuredClone(this.campaign.state)
        : undefined,
      winner: this.mode.winner,
      remaining: this.campaign
        ? this.campaign.objective.remaining
        : this.mode.remaining,
    };
    return includePaint ? { ...snapshot, paint: this.rt.paint.snapshot() } : snapshot;
  }
  takeFrame(includePaint?: true): GameFrame;
  takeFrame(includePaint: false): Omit<GameFrame, "snapshot"> & { snapshot: Omit<GameSnapshot, "paint"> };
  takeFrame(includePaint = true) {
    const frame = {
      snapshot: includePaint ? this.getSnapshot() : this.getSnapshot(false),
      events: this.rt.events.splice(0),
    };
    return frame;
  }
}
