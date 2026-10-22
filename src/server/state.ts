import type { WebSocket } from "ws";
import type { Simulation } from "../core/simulation";
import type { RoomMember, RoomSnapshot, RoomSettings, InputFrame } from "../shared/contracts";

export interface Member extends RoomMember {
  ws: WebSocket;
  token: string;
  room?: Room;
  expires?: ReturnType<typeof setTimeout>;
  lastSeq: number;
  lastInputAt: number;
  inputReleased: boolean;
  inputs: InputFrame[];
}
export interface Room {
  snapshot: RoomSnapshot;
  members: Member[];
  simulation?: Simulation;
  matchId?: string;
  accumulator: number;
  last: number;
  broadcastTicks: number;
}

export interface GameServerOptions {
  port?: number;
  host?: string;
  distDir?: string;
  reconnectMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  createSimulation?: (settings: RoomSettings) => Simulation;
}
export type SendMessage = (ws: WebSocket, message: object) => void;
