import type {
  ClassId,
  Checkpoint,
  GameSession,
  GameFrame,
  GameSnapshot,
  InputFrame,
  SessionCommand,
} from "../shared/contracts";
import { Simulation } from "../core/simulation";
import { LocalSessionDriver } from "./local-driver";
import { ProfileStore } from "../profile/store";
import { getLoadout } from "../content";
export interface LocalOptions {
  classId: ClassId;
  weapons?: string[];
  profileStore: ProfileStore;
  checkpoint?: Checkpoint;
  autoStart?: boolean;
}
export class LocalSession implements GameSession {
  readonly playerId = "local-player";
  private driver: LocalSessionDriver;
  private awarded = false;
  private settled = false;
  private seed: number;
  private completed: number;
  private upgradeIds: string[];
  private loadout: string[];
  private kills = 0;
  constructor(private options: LocalOptions) {
    const cp = options.checkpoint;
    this.seed = cp?.seed ?? Math.floor(Math.random() * 2147483647);
    this.completed = cp?.completed ?? 0;
    this.kills = cp?.totalKills ?? 0;
    this.upgradeIds = [...(cp?.upgrades ?? [])];
    this.loadout = getLoadout(
      options.classId,
      cp?.weapons ?? options.weapons,
      options.profileStore.unlockedWeapons(options.classId),
    );
    this.driver = new LocalSessionDriver(this.playerId, this.makeSimulation(), (frame) => this.recordProgress(frame.snapshot));
    this.driver.start(options.autoStart !== false);
  }
  private makeSimulation(paint?: GameSnapshot["paint"]) {
    const mapId = ["construction", "street", "fortress"][
      Math.floor(this.completed / 3)
    ];
    const sim = new Simulation({
      modeId: "solo",
      mapId,
      seed: this.seed,
      campaign: { completed: this.completed, upgrades: this.upgradeIds },
      initialPaint: paint,
    });
    sim.addPlayer(
      this.playerId,
      this.options.profileStore.load().name,
      this.options.classId,
      this.loadout,
      "player",
    );
    return sim;
  }
  submitInput(input: InputFrame) {
    this.driver.submitInput(input);
  }
  command(command: SessionCommand) {
    if (!this.driver.active) return;
    if (command.type === "loadout" && this.driver.getSnapshot().phase === "upgrade") {
      this.loadout = getLoadout(
        this.options.classId,
        command.weapons ?? [],
        this.options.profileStore.unlockedWeapons(this.options.classId),
      );
    } else if (command.type === "continue" && this.driver.simulation.canContinue()) {
      const previous = this.driver.getSnapshot(),
        actor = previous.actors.find((a) => a.id === this.playerId)!;
      this.upgradeIds = [...actor.upgrades];
      this.kills += actor.kills;
      this.completed = previous.campaign!.completed;
      this.options.profileStore.checkpoint({
        classId: this.options.classId,
        seed: this.seed,
        completed: this.completed,
        upgrades: this.upgradeIds,
        weapons: this.loadout,
        totalKills: this.kills,
      });
      this.driver.simulation = this.makeSimulation(
        this.completed % 3 !== 0 ? previous.paint : undefined,
      );
      this.awarded = false;
    } else this.driver.simulation.command(this.playerId, command);
    this.driver.publish();
  }
  private recordProgress(snapshot: GameSnapshot) {
    if (
      (snapshot.phase === "upgrade" ||
        snapshot.phase === "victory") &&
      !this.awarded
    ) {
      this.awarded = true;
      this.options.profileStore.recordEncounter(this.options.classId);
    }
    if (
      (snapshot.phase === "defeat" || snapshot.phase === "victory") &&
      !this.settled
    ) {
      this.settled = true;
      this.options.profileStore.recordRun(
        snapshot.phase === "victory",
        this.kills +
          (snapshot.actors.find((a) => a.id === this.playerId)?.kills ??
            0),
      );
    }
  }
  advance(seconds: number) {
    this.driver.advance(seconds);
  }
  subscribe(fn: (frame: GameFrame) => void) {
    return this.driver.subscribe(fn);
  }
  getSnapshot() {
    return this.driver.getSnapshot();
  }
  dispose() {
    this.driver.dispose();
  }
}
export function createLocalSession(options: LocalOptions) {
  return new LocalSession(options);
}
