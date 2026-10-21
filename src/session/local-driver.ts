import type { GameFrame, GameSession, InputFrame, SessionCommand } from "../shared/contracts";
import type { Simulation } from "../core/simulation";

/** Owns local ticking, event IDs and subscriptions; game progression belongs to its session. */
export class LocalSessionDriver implements GameSession {
  private listeners = new Set<(frame: GameFrame) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private eventSerial = 0;
  private last = 0;
  private accumulator = 0;
  private snapshot;

  constructor(
    readonly playerId: string,
    public simulation: Simulation,
    private onFrame: (frame: GameFrame) => void = () => {},
  ) {
    this.snapshot = simulation.getSnapshot();
  }

  start(autoStart = true) {
    if (!autoStart || this.disposed || this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.accumulator += Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      while (this.accumulator >= 1 / 60) {
        this.simulation.step();
        this.accumulator -= 1 / 60;
      }
      this.publish();
    }, 1000 / 60);
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = () => {
    if (document.hidden && this.snapshot.phase === "playing")
      this.command({ type: "pause" });
  };

  get active() { return !this.disposed; }

  submitInput(input: InputFrame) {
    if (!this.disposed) this.simulation.input(this.playerId, input);
  }

  command(command: SessionCommand) {
    if (this.disposed) return;
    this.simulation.command(this.playerId, command);
    this.publish();
  }

  publish() {
    if (this.disposed) return;
    const frame = this.simulation.takeFrame();
    this.snapshot = frame.snapshot;
    frame.events = frame.events.map((event) => ({ ...event, id: ++this.eventSerial }));
    this.onFrame(frame);
    for (const listener of this.listeners) listener(frame);
  }

  advance(seconds: number) {
    if (this.disposed) return;
    this.simulation.advance(seconds);
    this.publish();
  }

  subscribe(listener: (frame: GameFrame) => void) {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    listener({ snapshot: this.snapshot, events: [] });
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot() { return this.snapshot; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.onVisibility);
  }
}
