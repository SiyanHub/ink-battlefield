import { randomBytes, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { Simulation } from "../core/simulation";
import { getLoadout } from "../content";
import {
  fail,
  parseInput,
  parseRoomSettings,
  parseHello,
  parseChoice,
  parseRespawn,
  type WireMessage,
} from "./protocol";
import type { GameServerOptions, Member, Room, SendMessage } from "./state";

/** Owns identities, reconnect leases, membership, and match lifecycle for one server. */
export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private tokens = new Map<string, Member>();
  private closing = false;
  constructor(private options: GameServerOptions, private send: SendMessage) {}
  activeRooms = () => this.rooms.values();
  broadcast = (r: Room) => {
    r.snapshot.members = r.members.map(
      ({ ws, token, room, expires, lastSeq, lastInputAt, inputReleased, inputs, ...m }) => m,
    );
    for (const m of r.members) this.send(m.ws, { type: "room", room: r.snapshot });
  };
  remove = (m: Member) => {
    clearTimeout(m.expires);
    const r = m.room;
    this.tokens.delete(m.token);
    m.room = undefined;
    if (!r) return;
    r.members = r.members.filter((p) => p !== m);
    r.simulation?.removePlayer(m.id);
    if (!r.members.length) {
      this.rooms.delete(r.snapshot.code);
      return;
    }
    if (r.snapshot.hostId === m.id)
      r.snapshot.hostId = (
        r.members.find((p) => p.connected) ?? r.members[0]
      ).id;
    this.broadcast(r);
  };
  full = (m: Member, type = "start") => {
    const r = m.room;
    if (r?.simulation)
      this.send(m.ws, {
        type,
        matchId: r.matchId,
        frame: { snapshot: r.simulation.getSnapshot(), events: [] },
        ack: r.simulation.acknowledgedInput(m.id),
      });
  };

  identify(ws: WebSocket, m: WireMessage): Member {
    let member: Member;
    const identity = parseHello(m);
    if (identity.token !== undefined) {
      const candidate = this.tokens.get(identity.token);
      if (!candidate) fail("重连凭证失效");
      if (candidate.connected) fail("原连接尚未断开，请稍后重连", "resume_pending");
      member = candidate;
      clearTimeout(member.expires);
      member.ws = ws;
      member.connected = true;
    } else {
      const id = randomUUID();
      member = {
        id,
        token: randomBytes(32).toString("hex"),
        name: identity.name,
        classId: "assault",
        weapons: getLoadout("assault"),
        teamId: id,
        ready: false,
        connected: true,
        ws,
        lastSeq: -1,
        lastInputAt: performance.now(),
        inputReleased: true,
        inputs: [],
      };
      this.tokens.set(member.token, member);
    }

    return member;
  }
  handle(member: Member, m: WireMessage) {
    const ws = member.ws;
    let r = member.room;
    if (m.type === "create") {
      if (r) fail("请先退出当前房间");
      const config = parseRoomSettings(m.settings);
      let code: string;
      do {
        code = randomBytes(3).toString("hex").toUpperCase();
      } while (this.rooms.has(code));
      r = {
        snapshot: {
          code,
          hostId: member.id,
          status: "lobby",
          settings: config,
          members: [],
        },
        members: [member],
        last: performance.now(),
        accumulator: 0,
        broadcastTicks: 0,
      };
      member.room = r;
      this.rooms.set(code, r);
      this.broadcast(r);
      return;
    }
    if (m.type === "join") {
      if (r) fail("已在房间");
      if (typeof m.code !== "string") fail("房间码无效");
      r = this.rooms.get(m.code.toUpperCase());
      if (!r) fail("房间不存在");
      if (r.snapshot.status !== "lobby") fail("比赛已开始");
      if (r.members.length >= r.snapshot.settings.maxPlayers)
        fail("房间已满");
      member.room = r;
      r.members.push(member);
      this.broadcast(r);
      return;
    }
    if (!r) fail("尚未加入房间");
    if (m.type === "input") {
      if (r.snapshot.status === "finished") return;
      if (r.snapshot.status !== "playing") fail("比赛尚未开始");
      const frame = parseInput(m.input);
      if (frame.seq <= member.lastSeq) return;
      if (member.inputs.length >= 128) {
        ws.close(1008, "Input queue overflow");
        return;
      }
      member.lastSeq = frame.seq;
      member.lastInputAt = performance.now();
      member.inputReleased = false;
      member.inputs.push(frame);
      return;
    }
    if (m.type === "command") {
      const command = parseRespawn(m.command);
      r.simulation?.command(member.id, command);
      return;
    }
    if (m.type === "rematch") {
      if (
        r.snapshot.hostId !== member.id ||
        r.snapshot.status !== "finished"
      )
        fail("仅房主可在结算后重赛");
      r.simulation = undefined;
      r.snapshot.status = "lobby";
      for (const p of r.members) {
        p.ready = false;
        p.lastSeq = -1;
        p.inputReleased = true;
        p.inputs = [];
      }
      this.broadcast(r);
      return;
    }
    if (r.snapshot.status !== "lobby") fail("比赛已开始");
    if (m.type === "configure") {
      if (r.snapshot.hostId !== member.id) fail("仅房主可设置");
      const config = parseRoomSettings(m.settings, r.snapshot.settings);
      if (config.maxPlayers < r.members.length) fail("人数超过上限");
      r.snapshot.settings = config;
      for (const p of r.members) p.ready = false;
    } else if (m.type === "choose") {
      const selected = parseChoice(m);
      member.classId = selected.classId;
      member.weapons = selected.weapons;
      member.teamId = selected.teamId ?? member.id;
      member.ready = false;
    } else if (m.type === "ready") {
      if (typeof m.ready !== "boolean") fail("准备值无效");
      member.ready = m.ready;
    } else if (m.type === "start") {
      if (r.snapshot.hostId !== member.id) fail("仅房主可开始");
      if (
        r.members.length < 2 ||
        r.members.some((p) => !p.connected || !p.ready)
      )
        fail("至少两位在线玩家且所有玩家准备");
      if (
        r.snapshot.settings.teamMode &&
        (r.members.some((p) => !["red", "blue"].includes(p.teamId)) ||
          new Set(r.members.map((p) => p.teamId)).size !== 2)
      )
        fail("队伍模式需红蓝双方");
      r.simulation =
        this.options.createSimulation?.(r.snapshot.settings) ??
        new Simulation(r.snapshot.settings);
      r.matchId = randomUUID();
      r.last = performance.now();
      r.accumulator = 0;
      r.broadcastTicks = 0;
      for (const p of r.members) {
        p.lastSeq = -1;
        p.lastInputAt = performance.now();
        p.inputReleased = true;
        p.inputs = [];
        r.simulation.addPlayer(
          p.id,
          p.name,
          p.classId,
          p.weapons,
          r.snapshot.settings.teamMode ? p.teamId : p.id,
        );
      }
      r.snapshot.status = "playing";
      for (const p of r.members) this.full(p);
    } else fail("未知消息");
    this.broadcast(r);
  }
  disconnect(member: Member) {
    member.connected = false;
    member.ready = false;
    if (this.closing) return;
    if (!member.room) {
      this.tokens.delete(member.token);
      return;
    }
    member.inputs = [];
    member.inputReleased = true;
    member.room.simulation?.releaseInput(member.id);
    this.broadcast(member.room);
    const disconnected = member;
    member.expires = setTimeout(
      () => this.remove(disconnected),
      this.options.reconnectMs ?? 30000,
    );
  }
  dispose() {
    this.closing = true;
    for (const member of this.tokens.values()) {
      clearTimeout(member.expires);
      member.inputs = [];
      member.room = undefined;
    }
    this.tokens.clear();
    this.rooms.clear();
  }
}
