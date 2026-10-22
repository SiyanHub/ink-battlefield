import type {
  ActorSnapshot,
  GameEvent,
  InputFrame,
  WeaponDefinition,
  MapDefinition,
  ProjectileSnapshot,
  EnemyDefinition,
} from "../shared/contracts";
import { World } from "./world";
import { PaintField } from "./paint";
import { rng } from "./math";
import { weapons, enemies, upgrades } from "../content";
export interface ActorRuntime {
  actor: ActorSnapshot;
  input: InputFrame;
  lastPrimary: boolean;
  lastDamage: number;
  airJumped: boolean;
  lastSeq: number;
  processedSeq: number;
  attackAt: number;
  pendingAttack: string | null;
  pendingClass?: string;
  pendingWeapons?: string[];
  burstLeft: number;
  burstAt: number;
  status: Record<string, number>;
}
export interface ProjectileRuntime {
  snapshot: ProjectileSnapshot;
  damage: number;
  gravity: number;
  expires: number;
  splash: number;
  paintRadius: number;
  cluster: boolean;
  remainingRange: number;
  penetration: number;
  ricochets: number;
  hitActors: Set<string>;
  headMultiplier: number;
  blockAllies: boolean;
}
export class Runtime {
  time = 0;
  tick = 0;
  serial = 0;
  actors = new Map<string, ActorRuntime>();
  projectiles = new Map<string, ProjectileRuntime>();
  events: GameEvent[] = [];
  readonly world: World;
  readonly paint: PaintField;
  readonly random: () => number;
  readonly weapons: Record<string, WeaponDefinition>;
  readonly enemies: Record<string, EnemyDefinition>;
  onDeath: (target: ActorSnapshot, source: ActorSnapshot | null) => void =
    () => {};
  constructor(
    readonly map: MapDefinition,
    readonly solo: boolean,
    seed: number,
    content?: {
      weapons?: Record<string, WeaponDefinition>;
      enemies?: Record<string, EnemyDefinition>;
    },
  ) {
    this.world = new World(map);
    this.paint = new PaintField(map.surfaces, map.boxes);
    this.random = rng(seed);
    this.weapons = { ...weapons, ...content?.weapons };
    this.enemies = { ...enemies, ...content?.enemies };
  }
  emit(event: Omit<GameEvent, "id">) {
    this.events.push({ id: ++this.serial, ...event });
    if (this.events.length > 512) this.events.shift();
  }
  effect(actor: ActorSnapshot, key: string): number {
    return actor.upgrades.reduce(
      (sum, id) =>
        sum + (upgrades[id]?.effect === key ? upgrades[id].amount : 0),
      0,
    );
  }
}
