import { Input } from "./input";
import { Renderer } from "./renderer";
import { spectatorPosition } from "./presenter";
import { GameController } from "./ui/controller";
import { renderMenu, saveWarning } from "./ui/views";
import { renderHud, renderPracticeTools } from "./ui/hud";
import { ProfileStore, PROFILE_KEY } from "../profile/store";

/** Browser composition root: owns DOM/input/rendering; the controller owns the game session. */
export class App {
  readonly controller: GameController;
  readonly renderer: Renderer;
  readonly input: Input;
  private root = document.querySelector<HTMLElement>("#menus")!;
  private hud = document.querySelector<HTMLElement>("#hud")!;
  private battleHud = document.createElement("div");
  private practiceTools = document.createElement("div");
  private saveStatus = document.createElement("div");
  private toast = document.querySelector<HTMLElement>("#toast")!;
  private lastDraw = 0;
  private lastHud = 0;
  private phase = "";
  private showScores = false;
  private savedLook: { yaw: number; pitch: number } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
    const store = new ProfileStore();
    this.battleHud.className = "battle-status";
    this.practiceTools.className = "practice-tools";
    this.hud.append(this.battleHud, this.practiceTools);
    this.saveStatus.id = "save-status";
    document.body.append(this.saveStatus);
    this.renderer = new Renderer(canvas, () => store.settings);
    this.input = new Input(canvas, () => store.settings.sensitivity * Math.tan(this.renderer.camera.fov*Math.PI/360)/Math.tan(74*Math.PI/360), preserve => this.controller.toggleMenu(preserve), show => { this.showScores = show; }, message => this.notice(message));
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const address = location.port ? `${protocol}://${location.hostname}:${location.port === "8902" ? "8903" : location.port}/ws` : `${protocol}://${location.host}/ws`;
    this.controller = new GameController(store, {
      changed: () => this.render(),
      started: session => {
        this.releaseInput();
        this.phase = "";
        this.renderer.resetSession(session.getSnapshot());
        const player = session.getSnapshot().actors.find(actor => actor.id === session.playerId);
        this.input.yaw = player?.yaw ?? 0;
        this.input.pitch = 0;
        this.renderer.unlockAudio();
      },
      stopped: () => {
        this.releaseInput(); this.renderer.spectator = null; this.savedLook = null; this.phase = ""; this.battleHud.innerHTML = ""; this.practiceTools.innerHTML = "";
      },
      frame: (frame, playerId) => this.renderer.frame(frame, playerId),
      releaseInput: () => this.releaseInput(),
      inspect: active => this.inspect(active),
      settingsChanged: () => {
        this.renderer.resize();
        this.hud.style.setProperty("--hud-scale", String(store.settings.hudScale ?? 1));
      },
      notice: message => this.notice(message),
      saveStateChanged: () => { this.saveStatus.innerHTML = saveWarning(this.controller); },
      capture: async (snapshot, compare) => {
        const blob = await this.renderer.captureBattlefield(snapshot, { compare });
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = `墨绘战场-${snapshot.mapId}-${compare ? "前后对照" : "战场留影"}-${Date.now()}.png`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      },
    }, address, import.meta.env.MODE === "cloud");
    this.toast.setAttribute("role", "status");
    this.toast.setAttribute("aria-live", "polite");
    this.hud.style.setProperty("--hud-scale", String(store.settings.hudScale ?? 1));
    this.hud.addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
      if (!button || button.disabled) return;
      this.releaseInput();
      void this.controller.action(button.dataset.action!);
    });
    window.addEventListener("beforeunload", event => {
      if (store.hasUnsavedChanges) { event.preventDefault(); event.returnValue = ""; }
    });
    this.saveStatus.addEventListener("click", event => {
      if ((event.target as HTMLElement).closest('[data-action="retry-save"]')) void this.controller.action("retry-save");
    });
    window.addEventListener("storage", event => {
      if (event.key === PROFILE_KEY || event.key === null) {
        store.refresh(); this.renderer.resize();
        this.hud.style.setProperty("--hud-scale", String(store.settings.hudScale ?? 1));
        this.render();
      }
    });
    this.root.addEventListener("click", event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (!target || target.hasAttribute("disabled")) return;
      this.renderer.unlockAudio();
      if (["create", "join"].includes(target.dataset.action!)) {
        for (const id of ["name", "address", "code"]) {
          const element = this.root.querySelector<HTMLInputElement>(`#${id}`);
          if (element) this.controller.change(id, element.value);
        }
      }
      void this.controller.action(target.dataset.action!, target.dataset);
    });
    this.root.addEventListener("change", event => {
      const el = event.target as HTMLInputElement;
      const field = el.dataset.setting ? `setting:${el.dataset.setting}` : el.dataset.slot ? `slot:${el.dataset.slot}` : el.dataset.room ? `room:${el.dataset.room}` : el.id;
      const value = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
      this.controller.change(field, field === "setting:hudScale" ? Number(value) : value);
    });
    this.root.addEventListener("keydown", event => {
      if (event.key === "Enter" && this.controller.state.screen === "network" && (event.target as HTMLElement).matches("input")) {
        event.preventDefault();
        this.root.querySelector<HTMLButtonElement>('[data-action="join"]')?.click();
      }
    });
    this.render();
    if (store.recoveryNotice) this.notice(store.recoveryNotice);
    requestAnimationFrame(time => this.loop(time));
  }
  private releaseInput() {
    this.input.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  private notice(message: string) {
    clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.classList.add("visible");
    this.toastTimer = setTimeout(() => this.toast.classList.remove("visible"), 6000);
  }
  private inspect(active: boolean) {
    this.releaseInput();
    if (active) {
      this.savedLook = { yaw: this.input.yaw, pitch: this.input.pitch };
      this.renderer.spectator = this.renderer.camera.position.clone();
    } else {
      this.renderer.spectator = null;
      if (this.savedLook) Object.assign(this.input, this.savedLook);
      this.savedLook = null;
    }
  }
  render() {
    const game = this.controller, state = game.state, snapshot = game.session?.getSnapshot();
    const player = snapshot?.actors.find(actor => actor.id === game.session?.playerId);
    this.input.enabled = state.screen === "inspect" || (!!snapshot && snapshot.phase === "playing" && !!player?.alive && !state.menuOpen && state.screen === "game");
    if (!this.input.enabled) this.releaseInput();
    const focused = document.activeElement as HTMLElement | null;
    const action = focused?.dataset.action, id = focused?.dataset.id, slot = focused?.dataset.slot;
    this.root.innerHTML = renderMenu(game);
    this.saveStatus.innerHTML = saveWarning(game);
    const toolbar = snapshot?.modeId === "practice" ? renderPracticeTools(!!state.guidedPractice) : "";
    if (this.practiceTools.innerHTML !== toolbar) this.practiceTools.innerHTML = toolbar;
    this.practiceTools.classList.toggle("guided", !!state.guidedPractice);
    this.root.classList.toggle("active", !!this.root.innerHTML);
    this.root.classList.toggle("spectating", state.screen === "inspect");
    this.hud.hidden = !game.session || !this.input.enabled || state.screen === "inspect";
    if (slot !== undefined) this.root.querySelector<HTMLSelectElement>(`[data-slot="${slot}"]`)?.focus({ preventScroll: true });
    if (action) {
      const replacement = [...this.root.querySelectorAll<HTMLButtonElement>("[data-action]")].find(el => el.dataset.action === action && el.dataset.id === id);
      replacement?.focus({ preventScroll: true });
    }
  }
  private loop(time: number) {
    const dt = Math.min(0.05, (time - this.lastDraw) / 1000);
    this.lastDraw = time;
    const game = this.controller, session = game.session, snapshot = session?.getSnapshot() ?? null;
    if (snapshot && session) {
      const player = snapshot.actors.find(actor => actor.id === session.playerId);
      const phase = `${snapshot.phase}:${player?.alive}`;
      if (phase !== this.phase) { this.phase = phase; this.render(); }
      if (game.state.screen === "inspect" && this.renderer.spectator) {
        const input = this.input.sample(0);
        const vertical = Number(this.input.keys.has("Space")) - Number(this.input.keys.has("ControlLeft") || this.input.keys.has("ControlRight"));
        const pos = spectatorPosition(this.renderer.spectator, this.input.yaw, input.moveZ, input.moveX, vertical, dt * (input.sprint ? 2 : 1));
        this.renderer.spectator.set(pos.x, pos.y, pos.z);
      } else session.submitInput(this.input.sample(player?.weapons.indexOf(player.weaponId) ?? 0, player?.weapons.flatMap((id, slot) => id ? [slot] : []) ?? []));
      if (time - this.lastHud > 100 && !this.hud.hidden) { this.lastHud = time; this.battleHud.innerHTML = renderHud(snapshot, session.playerId, this.showScores, game.feedback.view(time / 1000, game.store.settings.reduceMotion), game.state.guidedPractice ? game.quickStart.view() : undefined); }
    }
    this.renderer.secondary = this.input.secondary;
    this.renderer.draw(snapshot, session?.playerId ?? "", this.input.yaw, this.input.pitch);
    this.hud.dataset.aim=this.renderer.aimMode;
    requestAnimationFrame(next => this.loop(next));
  }
}
