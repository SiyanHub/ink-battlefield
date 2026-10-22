import type { ClassId, GameFrame, GameSession, GameSnapshot, RoomSnapshot, RoomSettings } from "../../shared/contracts";
import { classes, maps } from "../../content";
import { ProfileStore } from "../../profile/store";
import { createLocalSession } from "../../session/local";
import { NetworkLobby } from "../../session/network";
import { BattleFeedback } from "./feedback";
import { QuickStartGuide } from "./quick-start";
import { menuTransition, TeamSelection } from "../presenter";

export type Screen = "home" | "class" | "network" | "room" | "records" | "settings" | "game" | "inspect";
export interface UiState {
  screen: Screen;
  mode: "campaign" | "practice" | "network" | "turf";
  turfMap?: string;
  networkMode?: "deathmatch" | "turf";
  selected: ClassId;
  loadout: string[];
  menuOpen: boolean;
  chosenUpgrade: boolean;
  busy: boolean;
  name: string;
  address: string;
  roomCode: string;
  guidedPractice?: boolean;
}
export interface PresentationPort {
  changed?(): void;
  started?(session: GameSession): void;
  stopped?(): void;
  frame?(frame: GameFrame, playerId: string): void;
  releaseInput?(): void;
  inspect?(active: boolean): void;
  settingsChanged?(): void;
  saveStateChanged?(): void;
  notice?(message: string): void;
  capture?(snapshot: GameSnapshot, compare: boolean): Promise<void>;
}

/** Owns navigation and the active session. Browser/WebGL resources stay at the presentation boundary. */
export class GameController {
  readonly state: UiState;
  readonly feedback = new BattleFeedback();
  readonly quickStart = new QuickStartGuide();
  team = new TeamSelection();
  session: GameSession | null = null;
  lobby: NetworkLobby | null = null;
  room: RoomSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private connectionGeneration = 0;

  constructor(readonly store = new ProfileStore(), private port: PresentationPort = {}, address = "", readonly hostedPreview = false) {
    this.state = { screen: "home", mode: "campaign", selected: "assault", loadout: [], menuOpen: false,
      chosenUpgrade: false, busy: false, name: store.load().name || "纸上旅人", address, roomCode: "" };
    store.onSaveNotice(message => { this.port.notice?.(message); this.port.saveStateChanged?.(); });
    this.selectClass("assault");
  }
  get online() { return this.state.mode === "network"; }
  get competitive() { return this.online || this.state.mode === "turf"; }
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
    this.quickStart.reset(session.getSnapshot(), session.playerId, !!this.state.guidedPractice && this.state.mode === "practice");
    this.port.started?.(session);
    this.unsubscribe = session.subscribe(frame => {
      this.feedback.apply(frame, session.playerId);
      this.quickStart.apply(frame);
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
    Object.assign(this.state, { screen: "home", mode: "campaign", menuOpen: false, busy: false, chosenUpgrade: false, guidedPractice: false });
    this.port.changed?.();
  }
  toggleMenu(preservePractice = false) {
    if (this.state.screen === "inspect") { this.state.screen = "game"; this.port.inspect?.(false); }
    else if (!preservePractice && this.session?.getSnapshot().modeId === "practice") {
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
    const profile = this.store.refresh();
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
    if (this.state.busy && ["begin", "create", "join", "continue-save", "capture", "capture-compare", "turf-restart"].includes(action)) return;
    try {
      switch (action) {
        case "turf":
          Object.assign(this.state, { mode: "turf", screen: "class", guidedPractice: false, turfMap: this.state.turfMap ?? "construction" });
          this.selectClass("artist");
          this.state.loadout = ["brush", "pencil", "roller"];
          break;
        case "turf-network":
          Object.assign(this.state, { mode: "network", screen: "network", networkMode: "turf", guidedPractice: false });
          break;
        case "turf-restart":
          if (this.state.mode !== "turf") break;
          await this.action("begin"); return;
        case "solo": case "practice":
          this.state.guidedPractice = false;
          this.state.mode = action === "practice" ? "practice" : "campaign";
          this.state.screen = "class";
          this.selectClass(this.state.selected);
          break;
        case "guided-practice":
          this.state.mode = "practice"; this.state.guidedPractice = true;
          await this.action("begin"); return;
        case "guide-campaign":
          if (this.state.mode !== "practice") break;
          this.stopSession();
          Object.assign(this.state, { screen: "class", mode: "campaign", menuOpen: false, guidedPractice: false });
          break;
        case "home": this.leave(); return;
        case "records": this.state.screen = "records"; break;
        case "settings": this.state.screen = "settings"; break;
        case "practice-pause": this.toggleMenu(true); break;
        case "retry-save": if (!this.store.retrySave()) this.port.notice?.(this.store.recoveryNotice); break;
        case "class": this.selectClass(data.id as ClassId); break;
          case "equip-primary": {
            const id=data.id;
            if(id&&classes[this.state.selected].weapons.includes(id)){
              if(this.state.loadout[1]===id)this.state.loadout[1]=this.state.loadout[0];
              this.state.loadout[0]=id;
            }
            break;
          }
        case "begin": {
          this.state.busy = true;
          const generation = ++this.connectionGeneration;
          this.port.changed?.();
          if (this.state.mode === "practice") {
            const { createPracticeSession } = await import("../../session/practice");
            if (generation !== this.connectionGeneration) return;
            this.start(createPracticeSession({ classId: this.state.selected, weapons: this.state.loadout }));
          } else if (this.state.mode === "turf") {
            const { createTurfSession } = await import("../../session/turf");
            if (generation !== this.connectionGeneration) return;
            this.start(createTurfSession({ classId: this.state.selected, weapons: this.state.loadout, mapId: this.state.turfMap ?? "construction" }));
          } else this.start(createLocalSession({ classId: this.state.selected, weapons: this.state.loadout, profileStore: this.store }));
          break;
        }
        case "continue-save": {
          const checkpoint = this.store.load().checkpoint;
          if (checkpoint) { this.state.mode = "campaign"; this.start(createLocalSession({ classId: checkpoint.classId, checkpoint, profileStore: this.store })); }
          break;
        }
        case "network": this.state.mode = "network"; this.state.networkMode = "deathmatch"; this.state.screen = "network"; this.selectClass(this.state.selected); break;
        case "create": case "join": {
          this.state.busy = true; this.port.changed?.();
          const lobby = await this.connect();
          if (action === "create") lobby?.create({ modeId: this.state.networkMode ?? "deathmatch", mapId: this.state.turfMap ?? Object.keys(maps)[0], teamMode: this.state.networkMode === "turf", maxPlayers: 8 });
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
        case "capture": case "capture-compare": {
          const snapshot = this.session?.getSnapshot();
          if (!snapshot || (snapshot.modeId !== "practice" && !["victory", "defeat"].includes(snapshot.phase))) break;
          this.state.busy = true; this.port.changed?.();
          await this.port.capture?.(snapshot, action === "capture-compare");
          this.port.notice?.("留影已交给浏览器下载。");
          break;
        }
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
    else if (field === "turf-map" && maps[String(value)]) this.state.turfMap = String(value);
    else if (field === "name") { this.state.name = String(value); const profile = this.store.refresh(); profile.name = this.state.name; this.store.save(profile); }
    else if (field === "address") this.state.address = String(value);
    else if (field === "code") this.state.roomCode = String(value);
  }
}
