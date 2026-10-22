import type { ClassId } from "../shared/contracts";
import { maps } from "../content";
import { Simulation } from "../core/simulation";
import { TurfBots } from "../core/turf-bots";
import { LocalSessionDriver } from "./local-driver";

export interface TurfOptions {
  classId: ClassId;
  weapons?: string[];
  mapId?: string;
  autoStart?: boolean;
  seed?: number;
}

/** Offline competitive rules use disposable state, never the campaign profile. */
export class TurfSession extends LocalSessionDriver {
  constructor(options: TurfOptions) {
    const playerId = "turf-player", mapId = maps[options.mapId ?? "construction"] ? options.mapId ?? "construction" : "construction";
    const map = maps[mapId];
    let bots: TurfBots | undefined;
    const seed = options.seed ?? Math.floor(Math.random() * 2147483647);
    const simulation = new Simulation({ modeId: "turf", mapId, teamMode: true, allowPause: true, seed, beforeStep: () => bots?.update() });
    simulation.addPlayer(playerId, "蓝队·你", options.classId, options.weapons, "blue", map.spawns[0]);
    simulation.addPlayer("turf-blue-bot", "蓝队·涂绘搭档", "artist", ["pencil", "brush"], "blue", map.spawns[2]);
    simulation.addPlayer("turf-red-bot-1", "朱队·速写手", "assault", ["rifle", "smg"], "red", map.spawns[1]);
    simulation.addPlayer("turf-red-bot-2", "朱队·涂绘手", "artist", ["pencil", "brush"], "red", map.spawns[3]);
    bots = new TurfBots(simulation, map, ["turf-blue-bot", "turf-red-bot-1", "turf-red-bot-2"], seed);
    super(playerId, simulation);
    this.start(options.autoStart !== false);
  }
}

export function createTurfSession(options: TurfOptions): TurfSession { return new TurfSession(options); }
