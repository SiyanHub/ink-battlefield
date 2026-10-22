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
  PaintCell,
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
export interface NetworkHealthOptions {
  heartbeatIntervalMs?: number;
  silenceTimeoutMs?: number;
  reconnectDelayMs?: number;
  reconnectWindowMs?: number;
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
  private suspended = false;
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
    if (this.disposed || this.suspended || this.snapshot.phase !== "playing") {
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
    ) {
      const predicted = { ...actor, pos: { ...actor.pos }, vel: { ...actor.vel } };
      movePlayer(predicted, frame, this.world, 1 / 60);
      this.snapshot = { ...this.snapshot, actors: this.snapshot.actors.map(a => a === actor ? predicted : a) };
    }
  }
  private emit(frame: GameFrame) {
    for (const listener of this.listeners) listener(frame);
  }
  receive(message: any) {
    if (this.disposed) return;
    if (this.suspended) {
      this.suspended = false;
      this.lastTime = this.clock.now();
    }
    const incoming = message.frame as GameFrame;
    let paint: PaintSnapshot = incoming.snapshot.paint ?? this.snapshot.paint;
    const events = incoming.events.filter((e) => e.id > this.lastEvent);
    const updates = new Map<string, { cells: Map<number, PaintCell>; revisions: number }>();
    for (const e of events) {
      this.lastEvent = Math.max(this.lastEvent, e.id);
      if (e.type !== "paint" || !e.surfaceId || !e.cells) continue;
      let update = updates.get(e.surfaceId);
      if (!update) {
        const surface = paint.surfaces.find(s => s.id === e.surfaceId);
        update = { cells: new Map(surface?.cells.map(cell => [cell[0], cell]) ?? []), revisions: 0 };
        updates.set(e.surfaceId, update);
      }
      for (const cell of e.cells) update.cells.set(cell[0], [...cell]);
      update.revisions++;
    }
    if (updates.size) {
      const surfaces = [...paint.surfaces];
      let revision = paint.revision;
      for (const [id, update] of updates) {
        const index = surfaces.findIndex(surface => surface.id === id);
        const surface = { id, revision: (index < 0 ? 0 : surfaces[index].revision) + update.revisions, cells: [...update.cells.values()] };
        if (index < 0) surfaces.push(surface);
        else surfaces[index] = surface;
        revision += update.revisions;
      }
      paint = { revision, surfaces };
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
    if (this.disposed || this.suspended || this.snapshot.phase !== "playing") return;
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
  suspend() {
    this.suspended = true;
    this.pending = [];
    this.accumulator = 0;
    this.releaseInput();
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
  private stopWatchdog = () => {};
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
    private health: NetworkHealthOptions = {},
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
    this.stopWatchdog();
    this.socket?.close();
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
      let receivedAt = Date.now();
      let watchdog: ReturnType<typeof setInterval> | undefined;
      const cleanup = () => { clearTimeout(timeout); clearInterval(watchdog); };
      this.stopWatchdog = cleanup;
      const handshakeMs = Math.max(1, Math.min(this.health.silenceTimeoutMs ?? 5000,
        this.disconnectedAt ? (this.health.reconnectWindowMs ?? 29000) - (Date.now() - this.disconnectedAt) : Infinity));
      const timeout = setTimeout(() => {
        if (this.socket !== ws) return;
        cleanup();
        this.socket = null;
        ws.close();
        reject(Error("连接超时"));
        this.reconnect();
      }, handshakeMs);
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: "hello",
            name: this.name,
            ...(this.token ? { token: this.token } : {}),
          }),
        );
      ws.onmessage = (event) => {
        if (this.socket !== ws || this.stopped) return;
        let m: any;
        try {
          m = JSON.parse(event.data);
        } catch {
          return;
        }
        receivedAt = Date.now();
        if (m.type === "welcome") {
          clearTimeout(timeout);
          this.identity = m.playerId;
          this.token = m.token;
          welcomed = true;
          this.disconnectedAt = 0;
          watchdog = setInterval(() => {
            if (this.socket !== ws || this.stopped) { cleanup(); return; }
            if (Date.now() - receivedAt > (this.health.silenceTimeoutMs ?? 5000)) {
              cleanup();
              this.socket = null;
              ws.close();
              this.reconnect();
            } else this.send({ type: "ping" });
          }, this.health.heartbeatIntervalMs ?? 1000);
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
            if (this.token && m.code === "resume_pending") {
              cleanup();
              this.socket = null;
              ws.close();
              this.reconnect();
              return;
            }
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
        { if (this.socket === ws && !this.stopped) this.error("无法连接服务器，请检查地址、服务器状态和私有网络防火墙"); };
      ws.onclose = (event) => {
        cleanup();
        if (!welcomed) reject(Error("连接中断"));
        if (this.stopped || this.socket !== ws) return;
        this.socket = null;
        if (event.code === 4000 || event.code === 1008) {
          this.end(`会话已结束：${event.reason || "服务器已关闭连接"}`);
          return;
        }
        this.reconnect();
      };
    });
  }
  private reconnect() {
    if (this.stopped) return;
    this.session?.suspend();
    this.error("与服务器通信中断，正在尝试恢复连接");
    if (!this.token) return;
    this.disconnectedAt ||= Date.now();
    const remaining = (this.health.reconnectWindowMs ?? 29000) - (Date.now() - this.disconnectedAt);
    if (remaining <= 0) {
      this.end("会话已结束：重连超时，请重新加入房间");
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (Date.now() - this.disconnectedAt >= (this.health.reconnectWindowMs ?? 29000))
        this.end("会话已结束：重连超时，请重新加入房间");
      else void this.open().catch(() => {});
    }, Math.min(remaining, this.health.reconnectDelayMs ?? 1000));
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
    this.stopWatchdog();
    this.send({ type: "leave" });
    this.socket?.close(1000, "Leave room");
    this.socket = null;
    this.session?.dispose();
    this.session = null;
    this.token = "";
    this.lastRoom = null;
  }
}
