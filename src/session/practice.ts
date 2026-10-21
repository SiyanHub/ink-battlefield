import type { ClassId, GameSession, SessionCommand } from "../shared/contracts";
import { Simulation } from "../core/simulation";
import { LocalSessionDriver } from "./local-driver";
import { getLoadout } from "../content";

export interface PracticeOptions {
  classId: ClassId;
  weapons?: string[];
  autoStart?: boolean;
}

/** A disposable sandbox: no profile dependency and no campaign director. */
export class PracticeSession extends LocalSessionDriver {
  private loadout: string[];
  constructor(private options: PracticeOptions) {
    const playerId = "practice-player";
    const loadout = getLoadout(options.classId, options.weapons);
    const simulation = makeSimulation(playerId, options.classId, loadout);
    super(playerId, simulation);
    this.loadout = loadout;
    this.start(options.autoStart !== false);
  }

  override command(command: SessionCommand) {
    if (!this.active) return;
    if (command.type === "continue" || command.type === "loadout") {
      if (command.type === "loadout")
        this.loadout = getLoadout(this.options.classId, command.weapons);
      const paused = this.getSnapshot().phase === "paused";
      this.simulation = makeSimulation(this.playerId, this.options.classId, this.loadout);
      if (paused) this.simulation.command(this.playerId, { type: "pause" });
      this.publish();
    } else super.command(command);
  }
}

function makeSimulation(playerId: string, classId: ClassId, loadout: string[]) {
  const simulation = new Simulation({ modeId: "practice", mapId: "construction", seed: 17 });
  simulation.addPlayer(playerId, "试笔者", classId, loadout);
  simulation.addEnemy("grunt", { x: -16, y: 0, z: 14 });
  simulation.addEnemy("marksman", { x: -20, y: 0, z: 9 });
  simulation.addEnemy("brute", { x: -12, y: 0, z: 14 });
  return simulation;
}

export function createPracticeSession(options: PracticeOptions): GameSession {
  return new PracticeSession(options);
}
