import type { ClassId, GameFrame, GameSession, RoomSnapshot, RoomSettings } from "../../shared/contracts";
import { classes, maps } from "../../content";
import { ProfileStore } from "../../profile/store";
import { createLocalSession } from "../../session/local";
import { NetworkLobby } from "../../session/network";
import { BattleFeedback } from "./feedback";
import { menuTransition, TeamSelection } from "../presenter";

export type Screen = "home" | "class" | "network" | "room" | "records" | "settings" | "game" | "inspect";
export interface UiState {
  screen: Screen;
  mode: "campaign" | "practice" | "network";
  selected: ClassId;
  loadout: string[];
  menuOpen: boolean;
  chosenUpgrade: boolean;
  busy: boolean;
  name: string;
  address: string;
  roomCode: string;
}
export interface PresentationPort {
  changed?(): void;
  started?(session: GameSession): void;
  stopped?(): void;
  frame?(frame: GameFrame, playerId: string): void;
  releaseInput?(): void;
  inspect?(active: boolean): void;
  settingsChanged?(): void;
  notice?(message: string): void;
}

/** Owns navigation and the active session. Browser/WebGL resources stay at the presentation boundary. */
export class GameController {
  readonly state: UiState;
  readonly feedback = new BattleFeedback();
  team = new TeamSelection();
  session: GameSession | null = null;
  lobby: NetworkLobby | null = null;
  room: RoomSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private connectionGeneration = 0;

  constructor(readonly store = new ProfileStore(), private port: PresentationPort = {}, address = "", readonly hostedPreview = false) {
    this.state = { screen: "home", mode: "campaign", selected: "assault", loadout: [], menuOpen: false,
      chosenUpgrade: false, busy: false, name: store.load().name || "纸上旅人", address, roomCode: "" };
    this.selectClass("assault");
  }
  get online() { return this.state.mode === "network"; }
  selectClass(id: ClassId) {
    if (!classes[id]) return;
    this.state.selected = id;
    this.state.loadout = [...classes[id].weapons.slice(0, 2), classes[id].melee];
  }
  start(session: GameSession) {
    this.stopSession();
    this.session = session;
    this.state.screen = "game";
    this.state.menuOpen = false;
    this.state.chosenUpgrade = false;
    const player = session.getSnapshot().actors.find(a => a.id === session.playerId);
    if (player) { this.state.selected = player.classId; this.state.loadout = [...player.weapons]; }
    this.port.started?.(session);
    this.unsubscribe = session.subscribe(frame => {
      this.feedback.apply(frame, session.playerId);
      this.port.frame?.(frame, session.playerId);
    });
    this.port.changed?.();
  }
  private stopSession() {
    this.feedback.reset();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();
    this.session = null;
    this.port.stopped?.();
  }
  leave() {
    this.connectionGeneration++;
    const lobby = this.lobby;
    this.lobby = null;
    lobby?.disconnect();
    this.stopSession();
    this.room = null;
    this.team = new TeamSelection();
    Object.assign(this.state, { screen: "home", mode: "campaign", menuOpen: false, busy: false, chosenUpgrade: false });
    this.port.changed?.();
  }
  toggleMenu() {
    if (this.state.screen === "inspect") { this.state.screen = "game"; this.port.inspect?.(false); }
    else if (this.session?.getSnapshot().modeId === "practice") {
      this.stopSession();
      this.state.screen = "class";
      this.state.menuOpen = false;
    } else if (this.session && this.session.getSnapshot().phase !== "upgrade") {
      if (this.state.screen === "settings") this.state.screen = "game";
      const next = menuTransition(this.state.menuOpen || this.session.getSnapshot().phase === "paused", this.online);
      this.state.menuOpen = next.open;
      if (next.command) this.session.command({ type: next.command });
      if (next.open) this.port.releaseInput?.();
    }
    this.port.changed?.();
  }
  private async connect() {
    const generation = ++this.connectionGeneration;
    this.lobby?.disconnect();
    const profile = this.store.load();
    profile.name = this.state.name;
    this.store.save(profile);
    const lobby = new NetworkLobby(this.state.address);
    this.lobby = lobby;
    const current = () => this.lobby === lobby && this.connectionGeneration === generation;
    lobby.onError(message => { if (current()) this.port.notice?.(`连接提示：${message}`); });
    lobby.onEnded(reason => { if (current()) { this.leave(); this.port.notice?.(reason); } });
    lobby.subscribeRoom(room => {
      if (!current()) return;
      this.room = room;
      if (room.status === "lobby" && this.session) this.stopSession();
      this.team.initialize(room.members.find(member => member.id === lobby.playerId)?.teamId);
      if (!this.session) { this.state.screen = "room"; this.state.menuOpen = false; this.port.changed?.(); }
    });
    lobby.onSession(session => { if (current()) this.start(session); else session.dispose(); });
    await lobby.connect(this.state.name);
    return current() ? lobby : null;
  }
  async action(action: string, data: Record<string, string | undefined> = {}) {
    if (this.state.busy && ["begin", "create", "join", "continue-save"].includes(action)) return;
    try {
      switch (action) {
        case "solo": case "practice":
          this.state.mode = action === "practice" ? "practice" : "campaign";
          this.state.screen = "class";
          this.selectClass(this.state.selected);
          break;
        case "home": this.leave(); return;
        case "records": this.state.screen = "records"; break;
        case "settings": this.state.screen = "settings"; break;
        case "class": this.selectClass(data.id as ClassId); break;
        case "begin": {
          this.state.busy = true;
          const generation = ++this.connectionGeneration;
          this.port.changed?.();
          if (this.state.mode === "practice") {
            const { createPracticeSession } = await import("../../session/practice");
            if (generation !== this.connectionGeneration) return;
            this.start(createPracticeSession({ classId: this.state.selected, weapons: this.state.loadout }));
          } else this.start(createLocalSession({ classId: this.state.selected, weapons: this.state.loadout, profileStore: this.store }));
          break;
        }
        case "continue-save": {
          const checkpoint = this.store.load().checkpoint;
          if (checkpoint) { this.state.mode = "campaign"; this.start(createLocalSession({ classId: checkpoint.classId, checkpoint, profileStore: this.store })); }
          break;
        }
        case "network": this.state.mode = "network"; this.state.screen = "network"; this.selectClass(this.state.selected); break;
        case "create": case "join": {
          this.state.busy = true; this.port.changed?.();
          const lobby = await this.connect();
          if (action === "create") lobby?.create({ modeId: "deathmatch", mapId: Object.keys(maps)[0], teamMode: false, maxPlayers: 8 });
          else lobby?.join(this.state.roomCode.trim().toUpperCase());
          break;
        }
        case "ready": this.lobby?.choose(this.state.selected, this.state.loadout, this.team.value); this.lobby?.ready(true); break;
        case "start-room": this.lobby?.start(); break;
        case "resume": this.state.menuOpen = false; this.state.screen = "game"; if (!this.online) this.session?.command({ type: "resume" }); break;
        case "leave": this.leave(); return;
        case "upgrade": this.session?.command({ type: "upgrade", upgradeId: data.id }); this.state.chosenUpgrade = true; break;
        case "next": this.session?.command({ type: "loadout", weapons: this.state.loadout }); this.session?.command({ type: "continue" }); this.state.chosenUpgrade = false; break;
        case "respawn": this.session?.command({ type: "respawn", classId: this.state.selected, weapons: this.state.loadout }); break;
        case "rematch": this.lobby?.rematch(); break;
        case "inspect": this.state.screen = "inspect"; this.port.inspect?.(true); break;
        case "results": this.state.screen = "game"; this.port.inspect?.(false); break;
      }
    } catch (error) { this.port.notice?.(error instanceof Error ? error.message : String(error)); }
    finally { this.state.busy = false; this.port.changed?.(); }
  }
  change(field: string, value: string | number | boolean) {
    if (field.startsWith("setting:")) {
      this.store.updateSettings({ [field.slice(8)]: value }); this.port.settingsChanged?.();
    } else if (field.startsWith("slot:")) { this.state.loadout[Number(field.slice(5))] = String(value); this.port.changed?.(); }
    else if (field.startsWith("room:")) this.lobby?.configure({ [field.slice(5)]: value } as Partial<RoomSettings>);
    else if (field === "team") this.team.choose(String(value));
    else if (field === "name") { this.state.name = String(value); const profile = this.store.load(); profile.name = this.state.name; this.store.save(profile); }
    else if (field === "address") this.state.address = String(value);
    else if (field === "code") this.state.roomCode = String(value);
  }
}
