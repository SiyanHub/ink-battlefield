import type {
  ClassId,
  GameFrame,
  GameSession,
  GameSnapshot,
  InputFrame,
  RoomSettings,
  RoomSnapshot,
  SessionCommand,
  PaintSnapshot,
} from "../shared/contracts";
import { neutralInput } from "../shared/contracts";
import { maps } from "../content";
import { World, movePlayer } from "../core/world";
/** Injectable scheduler controls simulation time, never render sample count. */
export interface NetworkClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}
const realClock: NetworkClock = {
  now: () => performance.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};
const edgeKeys = ["jump", "reload", "skill", "grapple"] as const;
const selectedWeapons = (weapons: string[]) => [
  ...new Set(weapons.filter(Boolean)),
];
class NetworkSession implements GameSession {
  private snapshot: GameSnapshot;
  private listeners = new Set<(frame: GameFrame) => void>();
  private pending: InputFrame[] = [];
  private world: World;
  private lastEvent = -1;
  private disposed = false;
  private previous: GameSnapshot;
  private receivedAt: number;
  private timer: unknown;
  private lastTime: number;
  private accumulator = 0;
  private latest = neutralInput();
  private releaseInput = () => {
    this.latest = {
      ...neutralInput(),
      yaw: this.latest.yaw,
      pitch: this.latest.pitch,
    };
  };
  private visibilityChanged = () => {
    if (document.hidden) this.releaseInput();
  };
  constructor(
    readonly playerId: string,
    private lobby: NetworkLobby,
    readonly matchId: string,
    snapshot: GameSnapshot,
    private clock: NetworkClock,
  ) {
    this.snapshot = structuredClone(snapshot);
    this.previous = structuredClone(snapshot);
    this.world = new World(maps[snapshot.mapId]);
    this.lastTime = this.receivedAt = clock.now();
    this.timer = clock.setInterval(() => this.advance(), 8);
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.visibilityChanged);
    globalThis.addEventListener?.("blur", this.releaseInput);
  }
  private advance() {
    const now = this.clock.now();
    this.accumulator += Math.min(100, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    if (this.disposed || this.snapshot.phase !== "playing") {
      this.accumulator = 0;
      return;
    }
    while (this.accumulator + 1e-7 >= 1000 / 60) {
      this.accumulator -= 1000 / 60;
      const frame = this.lobby.sendInput(this.latest);
      for (const key of edgeKeys) this.latest[key] = false;
      this.latest.slot = null;
      if (!frame) continue;
      this.pending.push(frame);
      if (this.pending.length > 128) this.pending.shift();
      this.predict(frame);
      this.emit({ snapshot: this.snapshot, events: [] });
    }
  }
  private predict(frame: InputFrame) {
    const actor = this.snapshot.actors.find((a) => a.id === this.playerId);
    if (
      actor?.alive &&
      this.snapshot.phase === "playing" &&
      Math.hypot(actor.vel.x, actor.vel.y, actor.vel.z) < 16
    )
      movePlayer(actor, frame, this.world, 1 / 60);
  }
  private emit(frame: GameFrame) {
    for (const listener of this.listeners) listener(frame);
  }
  receive(message: any) {
    if (this.disposed) return;
    const incoming = message.frame as GameFrame;
    let paint: PaintSnapshot =
      incoming.snapshot.paint ?? structuredClone(this.snapshot.paint);
    const events = incoming.events.filter((e) => e.id > this.lastEvent);
    for (const e of events) {
      this.lastEvent = Math.max(this.lastEvent, e.id);
      if (e.type !== "paint" || !e.surfaceId || !e.cells) continue;
      let surface = paint.surfaces.find((s) => s.id === e.surfaceId);
      if (!surface) {
        surface = { id: e.surfaceId, revision: 0, cells: [] };
        paint.surfaces.push(surface);
      }
      const cells = new Map(surface.cells.map((c) => [c[0], c]));
      for (const cell of e.cells) cells.set(cell[0], cell);
      surface.cells = [...cells.values()];
      surface.revision++;
      paint.revision++;
    }
    this.previous = this.getSnapshot();
    this.snapshot = { ...incoming.snapshot, paint };
    this.receivedAt = this.clock.now();
    this.pending = this.pending.filter((i) => i.seq > message.ack);
    if (this.snapshot.phase === "playing")
      for (const frame of this.pending) this.predict(frame);
    else {
      this.pending = [];
      this.latest = neutralInput();
    }
    this.emit({ snapshot: this.snapshot, events });
  }
  submitInput(input: InputFrame) {
    if (this.disposed || this.snapshot.phase !== "playing") return;
    const next = { ...input };
    for (const key of edgeKeys) next[key] = input[key] || this.latest[key];
    next.slot = input.slot ?? this.latest.slot;
    this.latest = next;
  }
  command(command: SessionCommand) {
    if (!this.disposed)
      this.lobby.send({
        type: "command",
        command:
          command.type === "respawn" && command.weapons
            ? { ...command, weapons: selectedWeapons(command.weapons) }
            : command,
      });
  }
  subscribe(fn: (frame: GameFrame) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  getSnapshot() {
    const t = Math.max(
      0,
      Math.min(1, (this.clock.now() - this.receivedAt) / 50),
    );
    if (t >= 1) return this.snapshot;
    // This display copy is consumed by App.loop -> Renderer.draw, never by prediction.
    return {
      ...this.snapshot,
      actors: this.snapshot.actors.map((actor) => {
        if (actor.id === this.playerId) return actor;
        const old = this.previous.actors.find((p) => p.id === actor.id);
        if (
          !old ||
          old.alive !== actor.alive ||
          Math.hypot(
            old.pos.x - actor.pos.x,
            old.pos.y - actor.pos.y,
            old.pos.z - actor.pos.z,
          ) > 6
        )
          return actor;
        return {
          ...actor,
          pos: {
            x: old.pos.x + (actor.pos.x - old.pos.x) * t,
            y: old.pos.y + (actor.pos.y - old.pos.y) * t,
            z: old.pos.z + (actor.pos.z - old.pos.z) * t,
          },
        };
      }),
    };
  }
  dispose() {
    this.disposed = true;
    this.clock.clearInterval(this.timer);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.visibilityChanged);
    globalThis.removeEventListener?.("blur", this.releaseInput);
    this.listeners.clear();
    this.pending = [];
    this.latest = neutralInput();
  }
}
export class NetworkLobby {
  private identity = "";
  get playerId() {
    return this.identity;
  }
  private socket: WebSocket | null = null;
  private token = "";
  private name = "";
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private disconnectedAt = 0;
  private sequence = 0;
  private roomListeners = new Set<(room: RoomSnapshot) => void>();
  private errorListeners = new Set<(error: string) => void>();
  private endedListeners = new Set<(reason: string) => void>();
  private sessionListeners = new Set<(session: GameSession) => void>();
  private session: NetworkSession | null = null;
  private lastRoom: RoomSnapshot | null = null;
  constructor(
    private url: string,
    private clock: NetworkClock = realClock,
  ) {}
  connect(name: string): Promise<void> {
    this.name = name;
    this.stopped = false;
    return this.open();
  }
  private error(message: string) {
    for (const fn of this.errorListeners) fn(message);
  }
  private end(reason: string) {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.session?.dispose();
    this.session = null;
    this.socket = null;
    this.token = "";
    this.lastRoom = null;
    for (const fn of this.endedListeners) fn(reason);
  }
  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      let welcomed = false;
      const ws = new WebSocket(this.url);
      this.socket = ws;
      const timeout = setTimeout(() => {
        ws.close();
        reject(Error("连接超时"));
      }, 5000);
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: "hello",
            name: this.name,
            ...(this.token ? { token: this.token } : {}),
          }),
        );
      ws.onmessage = (event) => {
        let m: any;
        try {
          m = JSON.parse(event.data);
        } catch {
          return;
        }
        if (m.type === "welcome") {
          clearTimeout(timeout);
          this.identity = m.playerId;
          this.token = m.token;
          welcomed = true;
          this.disconnectedAt = 0;
          resolve();
        } else if (m.type === "room") {
          if (m.room.status === "lobby" && this.session) {
            this.session.dispose();
            this.session = null;
          }
          this.lastRoom = m.room;
          for (const fn of this.roomListeners) fn(m.room);
        } else if (m.type === "error") {
          this.error(m.message);
          if (!welcomed) {
            clearTimeout(timeout);
            reject(Error(m.message));
            if (this.token) this.end(`会话已结束：${m.message}`);
            else this.stopped = true;
            ws.close();
          }
        } else if (m.type === "start") {
          this.sequence = Math.max(this.sequence, m.ack ?? 0);
          if (this.session && this.session.matchId === m.matchId) {
            this.session.receive(m);
            return;
          }
          this.sequence = Math.max(0, m.ack ?? 0);
          this.session?.dispose();
          const session = new NetworkSession(
            this.playerId,
            this,
            m.matchId,
            m.frame.snapshot,
            this.clock,
          );
          this.session = session;
          for (const fn of this.sessionListeners) fn(session);
        } else if (
          m.type === "frame" &&
          this.session &&
          this.session.matchId === m.matchId
        )
          this.session.receive(m);
      };
      ws.onerror = () =>
        this.error("无法连接服务器，请检查地址、服务器状态和私有网络防火墙");
      ws.onclose = (event) => {
        clearTimeout(timeout);
        if (!welcomed) reject(Error("连接中断"));
        if (this.stopped) return;
        if (event.code === 4000 || event.code === 1008) {
          this.end(`会话已结束：${event.reason || "服务器已关闭连接"}`);
          return;
        }
        this.error("与服务器断开，正在尝试恢复连接");
        if (!this.token) return;
        this.disconnectedAt ||= Date.now();
        if (Date.now() - this.disconnectedAt > 29000) {
          this.end("会话已结束：重连超时，请重新加入房间");
          return;
        }
        this.reconnectTimer = setTimeout(() => {
          void this.open().catch(() => {});
        }, 1000);
      };
    });
  }
  send(message: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
  sendInput(input: InputFrame) {
    const frame = { ...input, seq: ++this.sequence };
    return this.send({ type: "input", input: frame }) ? frame : null;
  }
  subscribeRoom(fn: (room: RoomSnapshot) => void) {
    this.roomListeners.add(fn);
    if (this.lastRoom) fn(this.lastRoom);
    return () => this.roomListeners.delete(fn);
  }
  onError(fn: (message: string) => void) {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }
  onEnded(fn: (reason: string) => void) {
    this.endedListeners.add(fn);
    return () => this.endedListeners.delete(fn);
  }
  create(settings: RoomSettings) {
    this.send({ type: "create", settings });
  }
  join(code: string) {
    this.send({ type: "join", code });
  }
  configure(settings: Partial<RoomSettings>) {
    this.send({ type: "configure", settings });
  }
  choose(classId: ClassId, weapons: string[], teamId?: string) {
    this.send({
      type: "choose",
      classId,
      weapons: selectedWeapons(weapons),
      teamId,
    });
  }
  ready(ready: boolean) {
    this.send({ type: "ready", ready });
  }
  start() {
    this.send({ type: "start" });
  }
  rematch() {
    this.send({ type: "rematch" });
  }
  getSession(): GameSession | null {
    return this.session;
  }
  onSession(fn: (session: GameSession) => void) {
    this.sessionListeners.add(fn);
    return () => this.sessionListeners.delete(fn);
  }
  disconnect() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.send({ type: "leave" });
    this.socket?.close(1000, "Leave room");
    this.socket = null;
    this.session?.dispose();
    this.session = null;
    this.token = "";
    this.lastRoom = null;
  }
}
