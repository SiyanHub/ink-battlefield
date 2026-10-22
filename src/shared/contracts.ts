/** Public, serializable game contracts. No browser or renderer objects cross this boundary. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export type ClassId = "assault" | "heavy" | "scout" | "artist";
export type Phase = "playing" | "paused" | "upgrade" | "victory" | "defeat";
export interface InputFrame {
  seq: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  sprint: boolean;
  jump: boolean;
  primary: boolean;
  secondary: boolean;
  reload: boolean;
  skill: boolean;
  grapple: boolean;
  slot: number | null;
}
export const neutralInput = (): InputFrame => ({
  seq: 0,
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  jump: false,
  primary: false,
  secondary: false,
  reload: false,
  skill: false,
  grapple: false,
  slot: null,
});
export interface WeaponDefinition {
  id: string;
  name: string;
  description: string;
  classId: ClassId;
  melee: boolean;
  behavior: string;
  automatic: boolean;
  interval: number;
  damage: number;
  pvpDamage: number;
  range: number;
  spread: number;
  capacity: number;
  reload: number;
  paintRadius: number;
  color: number;
  pellets?: number;
  burst?: number;
  charge?: number;
  speed?: number;
  projectileRadius?: number;
  gravity?: number;
  splash?: number;
  knockback?: number;
  model: string;
}
export interface ClassDefinition {
  id: ClassId;
  name: string;
  subtitle: string;
  description: string;
  color: number;
  weapons: string[];
  melee: string;
  skill: string;
  skillName: string;
  skillDescription: string;
  skillCooldown: number;
}
export interface BoxDefinition {
  id: string;
  center: Vec3;
  size: Vec3;
  color?: number;
  scoring?: boolean;
  breakable?: boolean;
}
export interface PaintSurface {
  id: string;
  center: Vec3;
  u: Vec3;
  v: Vec3;
  normal: Vec3;
  width: number;
  height: number;
  cellSize: number;
  scoring: boolean;
  boxId: string;
}
export interface CaptureZone {
  id: string;
  name: string;
  center: Vec3;
  radius: number;
}
export interface MapDefinition {
  id: string;
  name: string;
  chapter: number;
  description: string;
  width: number;
  depth: number;
  boxes: BoxDefinition[];
  surfaces: PaintSurface[];
  spawns: Vec3[];
  enemySpawns: Vec3[];
  anchors: Vec3[];
  objectives: CaptureZone[];
  navigation: Vec3[];
}
export interface EnemyDefinition {
  id: string;
  name: string;
  hp: number;
  speed: number;
  damage: number;
  interval: number;
  range: number;
  behavior: string;
  color: number;
  radius: number;
  boss?: boolean;
}
export interface UpgradeDefinition {
  id: string;
  name: string;
  description: string;
  classId: ClassId | "all";
  effect: string;
  amount: number;
  maxStacks: number;
}
export interface AmmoState {
  clip: number;
  reserve: number;
  reloadUntil: number;
  nextFireAt: number;
  chargeStarted: number | null;
}
export interface ActorSnapshot {
  id: string;
  name: string;
  kind: "player" | "enemy";
  classId: ClassId;
  enemyId?: string;
  teamId: string;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  grounded: boolean;
  respawnAt: number;
  protectedUntil: number;
  skillUntil: number;
  skillCooldown: number;
  grappleCooldown: number;
  weaponId: string;
  weapons: string[];
  ammo: Record<string, AmmoState>;
  kills: number;
  deaths: number;
  upgrades: string[];
  color: number;
  tint: number;
  telegraph?: string;
  telegraphUntil?: number;
  markedUntil?: number;
}
export interface ProjectileSnapshot {
  id: string;
  ownerId: string;
  teamId: string;
  pos: Vec3;
  vel: Vec3;
  color: number;
  radius: number;
  weaponId: string;
}
/** Cell tuple: index, packed RGB, owner ID. Fixed grids bound persistence memory. */
export type PaintCell = [number, number, string];
export interface PaintSurfaceSnapshot {
  id: string;
  revision: number;
  cells: PaintCell[];
}
export interface PaintSnapshot {
  revision: number;
  surfaces: PaintSurfaceSnapshot[];
}
export interface ObjectiveSnapshot {
  title: string;
  description: string;
  progress: number;
  target: number;
  zoneId?: string;
  owner?: string;
  remaining: number;
  deviceHp?: number;
}
export interface CampaignSnapshot {
  chapter: number;
  encounter: number;
  completed: number;
  objectiveKind: "clear" | "paint" | "defend" | "boss";
  choices: string[];
  seed: number;
  won: boolean;
}
export interface GameSnapshot {
  tick: number;
  time: number;
  phase: Phase;
  modeId: string;
  mapId: string;
  actors: ActorSnapshot[];
  projectiles: ProjectileSnapshot[];
  paint: PaintSnapshot;
  scores: Record<string, number>;
  objective: ObjectiveSnapshot;
  campaign?: CampaignSnapshot;
  winner: string | null;
  remaining: number;
}
export interface GameEvent {
  id: number;
  type:
    | "shot"
    | "projectile"
    | "projectile-end"
    | "hit"
    | "death"
    | "paint"
    | "skill"
    | "grapple"
    | "spawn"
    | "stage"
    | "sound"
    | "telegraph";
  actorId?: string;
  targetId?: string;
  weaponId?: string;
  projectile?: ProjectileSnapshot;
  projectileId?: string;
  pos?: Vec3;
  to?: Vec3;
  normal?: Vec3;
  color?: number;
  amount?: number;
  text?: string;
  surfaceId?: string;
  cells?: PaintCell[];
}
export interface GameFrame {
  snapshot: GameSnapshot;
  events: GameEvent[];
}
export interface Checkpoint {
  classId: ClassId;
  seed: number;
  completed: number;
  upgrades: string[];
  weapons: string[];
  totalKills?: number;
}
export interface Profile {
  version: 1;
  name: string;
  settings: {
    sensitivity: number;
    volume: number;
    quality: "low" | "medium" | "high";
    reduceMotion: boolean;
    hudScale?: number;
  };
  progress: Record<ClassId, number>;
  stats: { runs: number; wins: number; kills: number };
  checkpoint: Checkpoint | null;
}
export interface SessionCommand {
  type: "pause" | "resume" | "upgrade" | "loadout" | "respawn" | "continue";
  upgradeId?: string;
  classId?: ClassId;
  weapons?: string[];
}
export interface GameSession {
  readonly playerId: string;
  submitInput(input: InputFrame): void;
  command(command: SessionCommand): void;
  subscribe(listener: (frame: GameFrame) => void): () => void;
  getSnapshot(): GameSnapshot;
  dispose(): void;
}
export interface RoomSettings {
  modeId: "deathmatch" | "control" | "turf";
  mapId: string;
  teamMode: boolean;
  maxPlayers: number;
}
export interface RoomMember {
  id: string;
  name: string;
  classId: ClassId;
  weapons: string[];
  teamId: string;
  ready: boolean;
  connected: boolean;
}
export interface RoomSnapshot {
  code: string;
  hostId: string;
  status: "lobby" | "playing" | "finished";
  settings: RoomSettings;
  members: RoomMember[];
}
