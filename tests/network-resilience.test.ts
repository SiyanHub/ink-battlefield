import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket, { WebSocketServer } from "ws";
import { createGameServer } from "../src/server/server";
import { Simulation } from "../src/core/simulation";
import { NetworkLobby } from "../src/session/network";
import { neutralInput, type GameSnapshot, type GameSession } from "../src/shared/contracts";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined, timeout = 3000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await delay(5);
  }
  throw new Error("Expected network state did not arrive");
}
class Peer {
  readonly ws: WebSocket;
  readonly opened: Promise<void>;
  readonly messages: any[] = [];
  constructor(url: string, autoPong = true) {
    this.ws = new WebSocket(url, { autoPong });
    this.opened = new Promise(resolve => this.ws.once("open", resolve));
    this.ws.on("error", () => {});
    this.ws.on("message", raw => this.messages.push(JSON.parse(raw.toString())));
  }
  send(message: object) { this.ws.send(JSON.stringify(message)); }
  wait(type: string, predicate: (message: any) => boolean = () => true) {
    return until(() => {
      const index = this.messages.findIndex(message => message.type === type && predicate(message));
      return index < 0 ? undefined : this.messages.splice(index, 1)[0];
    });
  }
  async hello(token?: string) {
    await this.opened;
    this.send({ type: "hello", name: "网络验收", ...(token ? { token } : {}) });
    return this.wait("welcome");
  }
}
async function match(choice?: { classId: string; weapons: string[] }) {
  const server = await createGameServer({ port: 0 });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const a = new Peer(url), b = new Peer(url);
  const identity = await a.hello();
  await b.hello();
  a.send({ type: "create", settings: { modeId: "deathmatch", mapId: "construction", teamMode: false, maxPlayers: 2 } });
  const room = await a.wait("room");
  b.send({ type: "join", code: room.room.code });
  await b.wait("room");
  if (choice) a.send({ type: "choose", ...choice });
  a.send({ type: "ready", ready: true });
  b.send({ type: "ready", ready: true });
  await a.wait("room", message => message.room.members.every((member: any) => member.ready));
  a.send({ type: "start" });
  await a.wait("start");
  await b.wait("start");
  return { server, a, b, identity, close: async () => { a.ws.terminate(); b.ws.terminate(); await server.close(); } };
}

test("an open socket stops stale movement and fire, tolerates a short input gap, and accepts the next real sequence", async () => {
  const f = await match();
  const player = (message: any) => message.frame.snapshot.actors.find((actor: any) => actor.id === f.identity.playerId);
  try {
    f.a.send({ type: "input", input: { ...neutralInput(), seq: 1, moveX: 1, primary: true } });
    const first = await f.a.wait("frame", message => message.ack === 1);
    const short = await f.a.wait("frame", message => message.frame.snapshot.time >= first.frame.snapshot.time + 0.1);
    assert.ok(player(short).pos.x > player(first).pos.x, "a normal short gap must keep held movement");
    const stopped = await f.a.wait("frame", message => message.frame.snapshot.time >= first.frame.snapshot.time + 0.8);
    const later = await f.a.wait("frame", message => message.frame.snapshot.time >= stopped.frame.snapshot.time + 0.25);
    assert.equal(f.a.ws.readyState, WebSocket.OPEN, "the input deadline does not eject a connected player");
    assert.ok(Math.abs(player(later).pos.x - player(stopped).pos.x) < 0.01, "stale movement must stop");
    assert.equal(player(later).ammo.rifle.clip, player(stopped).ammo.rifle.clip, "stale fire must stop");
    assert.equal(later.ack, 1, "releasing stale input must not acknowledge an invented sequence");
    f.a.send({ type: "input", input: { ...neutralInput(), seq: 2, moveX: -1 } });
    const resumed = await f.a.wait("frame", message => message.ack === 2);
    assert.ok(player(resumed).pos.x < player(later).pos.x, "the very next real input must be consumed");
  } finally { await f.close(); }
});

test("input expiry cancels a charged attack without firing and preserves the acknowledged sequence", async () => {
  const f = await match({ classId: "scout", weapons: ["bow"] });
  try {
    f.a.send({ type: "input", input: { ...neutralInput(), seq: 7, primary: true, secondary: true, yaw: 0.8, pitch: 0.4 } });
    const first = await f.a.wait("frame", message => message.ack === 7);
    const charged = first.frame.snapshot.actors.find((actor: any) => actor.id === f.identity.playerId);
    assert.notEqual(charged.ammo.bow.chargeStarted, null);
    const expired = await f.a.wait("frame", message => message.frame.snapshot.time >= first.frame.snapshot.time + 0.7);
    const actor = expired.frame.snapshot.actors.find((actor: any) => actor.id === f.identity.playerId);
    assert.equal(actor.ammo.bow.chargeStarted, null, "expiry cancels charging rather than simulating a trigger release");
    assert.equal(actor.ammo.bow.clip, charged.ammo.bow.clip);
    assert.equal(actor.yaw, 0.8);
    assert.equal(actor.pitch, 0.4);
    assert.equal(expired.ack, 7);
  } finally { await f.close(); }
});

test("server heartbeat detects a silent open transport and its identity can resume within the lease", async () => {
  const server = await createGameServer({ port: 0, heartbeatIntervalMs: 40, heartbeatTimeoutMs: 180 });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const silent = new Peer(url, false);
  let early: Peer | undefined;
  let resumed: Peer | undefined;
  try {
    const welcome = await silent.hello();
    silent.send({ type: "create", settings: { modeId: "deathmatch", mapId: "construction", teamMode: false, maxPlayers: 2 } });
    const room = await silent.wait("room");
    assert.equal(silent.ws.readyState, WebSocket.OPEN);
    early = new Peer(url);
    await early.opened;
    early.send({ type: "hello", name: "网络验收", token: welcome.token });
    assert.equal((await early.wait("error")).code, "resume_pending", "a still-online old connection is distinct from an expired credential");
    early.ws.terminate();
    await delay(400);
    assert.equal(silent.ws.readyState, WebSocket.CLOSED, "missing pong must be detected without a peer close");
    resumed = new Peer(url);
    assert.equal((await resumed.hello(welcome.token)).playerId, welcome.playerId);
    assert.equal((await resumed.wait("room")).room.code, room.room.code);
    await delay(300);
    assert.equal(resumed.ws.readyState, WebSocket.OPEN, "healthy heartbeat replies keep an idle lobby alive");
  } finally {
    silent.ws.terminate(); early?.ws.terminate(); resumed?.ws.terminate(); await server.close();
  }
});

test("client detects silent incoming traffic before close and reconnects with its existing identity", async () => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>(resolve => wss.once("listening", resolve));
  let connections = 0;
  const hellos: any[] = [];
  wss.on("connection", ws => {
    const connection = ++connections;
    ws.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "hello") {
        hellos.push(message);
        ws.send(JSON.stringify({ type: "welcome", playerId: "stable-player", token: "stable-token" }));
      } else if (connection > 1 && message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
      // Connection one deliberately keeps TCP/WebSocket open but sends no more messages.
    });
  });
  const lobby = new NetworkLobby(`ws://127.0.0.1:${(wss.address() as { port: number }).port}/ws`, undefined,
    { heartbeatIntervalMs: 40, silenceTimeoutMs: 180, reconnectDelayMs: 30 });
  const notices: string[] = [];
  lobby.onError(message => notices.push(message));
  try {
    await lobby.connect("网络验收");
    await delay(500);
    assert.equal(connections, 2, "client watchdog must reconnect even when no close was received");
    assert.equal(hellos[1].token, "stable-token");
    assert.equal(lobby.playerId, "stable-player");
    assert.ok(notices.some(message => /恢复|重连/.test(message)));
    await delay(300);
    assert.equal(connections, 2, "pong messages keep the recovered idle connection healthy");
  } finally {
    lobby.disconnect(); for (const ws of wss.clients) ws.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  }
});

test("lightweight simulation frames omit paint while full reconnect snapshots retain it", () => {
  const simulation = new Simulation({ modeId: "deathmatch", initialPaint: {
    revision: 1, surfaces: [{ id: "ground:top", revision: 1, cells: [[100, 0xff0000, "red"]] }],
  } });
  const full = simulation.getSnapshot();
  assert.equal(full.paint.surfaces.length, 1);
  const lightweight = simulation.takeFrame(false);
  assert.equal(Object.hasOwn(lightweight.snapshot, "paint"), false, "regular frames must not create a full paint snapshot");
  assert.deepEqual(simulation.getSnapshot().paint, full.paint);
});

async function clientFeed() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>(resolve => wss.once("listening", resolve));
  let socket: WebSocket | undefined;
  let connections = 0;
  wss.on("connection", ws => {
    connections++;
    socket = ws;
    ws.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "hello") ws.send(JSON.stringify({ type: "welcome", playerId: "local", token: "token" }));
      if (message.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    });
  });
  const lobby = new NetworkLobby(`ws://127.0.0.1:${(wss.address() as { port: number }).port}/ws`, undefined, { reconnectDelayMs: 20 });
  await lobby.connect("网络验收");
  const simulation = new Simulation({ modeId: "deathmatch" });
  simulation.addPlayer("local", "local", "assault");
  const snapshot = simulation.getSnapshot();
  snapshot.paint = { revision: 1, surfaces: [
    { id: "ground:top", revision: 1, cells: [[100, 0xff0000, "red"]] },
    { id: "north:south", revision: 1, cells: [[10, 0x0000ff, "blue"]] },
  ] };
  const ready = new Promise<GameSession>(resolve => lobby.onSession(resolve));
  socket!.send(JSON.stringify({ type: "start", matchId: "one", frame: { snapshot, events: [] }, ack: -1 }));
  const session = await ready;
  return {
    lobby, session, snapshot,
    get connections() { return connections; },
    interrupt: () => socket!.terminate(),
    send: async (message: object) => { socket!.send(JSON.stringify(message)); await delay(25); },
    close: async () => { lobby.disconnect(); for (const ws of wss.clients) ws.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); },
  };
}

test("network paint uses copy-on-write and retains prior public snapshots through deltas and a full resync", async () => {
  const f = await clientFeed();
  try {
    const before = f.session.getSnapshot();
    const savedPaint = structuredClone(before.paint);
    const { paint, ...snapshot } = f.snapshot;
    await f.send({ type: "frame", matchId: "one", ack: 0, frame: { snapshot: { ...snapshot, tick: 3 }, events: [] } });
    assert.equal(f.session.getSnapshot().paint, before.paint, "unchanged paint should share its immutable snapshot");
    const event = { id: 10, type: "paint", surfaceId: "ground:top", cells: [[100, 0x00ff00, "green"]] };
    await f.send({ type: "frame", matchId: "one", ack: 0, frame: { snapshot: { ...snapshot, tick: 6 }, events: [event] } });
    const changed = f.session.getSnapshot();
    assert.deepEqual(before.paint, savedPaint, "a new delta must not alter snapshots already returned to consumers");
    assert.notEqual(changed.paint, before.paint);
    assert.notEqual(changed.paint.surfaces[0], before.paint.surfaces[0]);
    assert.equal(changed.paint.surfaces[1], before.paint.surfaces[1], "untouched surfaces can stay shared");
    assert.equal(changed.paint.surfaces[0].cells[0][2], "green");
    await f.send({ type: "frame", matchId: "one", ack: 0, frame: { snapshot: { ...snapshot, tick: 9 }, events: [event] } });
    assert.equal(f.session.getSnapshot().paint, changed.paint, "a duplicate event must not apply twice");
    await f.send({ type: "start", matchId: "one", ack: 0, frame: { snapshot: f.snapshot, events: [] } });
    assert.deepEqual(f.session.getSnapshot().paint, savedPaint, "full reconnect snapshots replace all paint");
    assert.equal(changed.paint.surfaces[0].cells[0][2], "green", "resync leaves old snapshots unchanged");
    await f.send({ type: "start", matchId: "two", ack: -1, frame: {
      snapshot: { ...f.snapshot, paint: { revision: 0, surfaces: [] } }, events: [],
    } });
    assert.notEqual(f.lobby.getSession(), f.session);
    assert.deepEqual(f.lobby.getSession()!.getSnapshot().paint, { revision: 0, surfaces: [] }, "a new match must not inherit old paint");
  } finally { await f.close(); }
});

test("prediction does not move actors in a previously returned public snapshot", async () => {
  const f = await clientFeed();
  try {
    const before = f.session.getSnapshot();
    const position = structuredClone(before.actors[0].pos);
    f.session.submitInput({ ...neutralInput(), moveX: 1 });
    await delay(100);
    assert.ok(f.session.getSnapshot().actors[0].pos.x > position.x);
    assert.deepEqual(before.actors[0].pos, position);
  } finally { await f.close(); }
});

test("reconnection replaces the lost prediction backlog with the authoritative start state", async () => {
  const f = await clientFeed();
  try {
    f.session.submitInput({ ...neutralInput(), moveX: 1, primary: true });
    await delay(100);
    assert.ok(f.session.getSnapshot().actors[0].pos.x > f.snapshot.actors[0].pos.x);
    f.interrupt();
    await until(() => f.connections === 2 ? true : undefined);
    await delay(20);
    await f.send({ type: "start", matchId: "one", ack: -1, frame: { snapshot: f.snapshot, events: [] } });
    assert.equal(f.lobby.getSession(), f.session);
    assert.deepEqual(f.session.getSnapshot().actors[0].pos, f.snapshot.actors[0].pos,
      "inputs lost before disconnect must not be replayed after a full authority restore");
  } finally { await f.close(); }
});

test("a reconnect handshake cannot extend the reconnect deadline and no retries survive its terminal notice", async () => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>(resolve => wss.once("listening", resolve));
  let connections = 0;
  wss.on("connection", ws => {
    const index = ++connections;
    ws.on("message", raw => {
      if (index === 1 && JSON.parse(raw.toString()).type === "hello")
        ws.send(JSON.stringify({ type: "welcome", playerId: "local", token: "token" }));
      // Later connections accept WebSocket but never complete the game handshake.
    });
  });
  const lobby = new NetworkLobby(`ws://127.0.0.1:${(wss.address() as { port: number }).port}/ws`, undefined,
    { heartbeatIntervalMs: 20, silenceTimeoutMs: 180, reconnectDelayMs: 20, reconnectWindowMs: 80 });
  let lost = false, ended = "";
  lobby.onError(() => { lost = true; });
  lobby.onEnded(message => { ended = message; });
  try {
    await lobby.connect("网络验收");
    await until(() => lost ? true : undefined);
    await delay(130);
    assert.match(ended, /重连超时/, "the retry handshake must fit within the remaining recovery window");
    assert.equal(lobby.getSession(), null);
    const count = connections;
    await delay(250);
    assert.equal(connections, count);
  } finally {
    lobby.disconnect(); for (const ws of wss.clients) ws.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  }
});

test("client retries a still-online old identity without treating it as an expired reconnect credential", async () => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>(resolve => wss.once("listening", resolve));
  let connections = 0;
  wss.on("connection", ws => {
    const index = ++connections;
    ws.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "hello") {
        ws.send(JSON.stringify(index === 2
          ? { type: "error", code: "resume_pending", message: "原连接尚未断开，请稍后重连" }
          : { type: "welcome", playerId: "local", token: "token" }));
      } else if (index > 2 && message.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    });
  });
  const lobby = new NetworkLobby(`ws://127.0.0.1:${(wss.address() as { port: number }).port}/ws`, undefined,
    { heartbeatIntervalMs: 30, silenceTimeoutMs: 120, reconnectDelayMs: 20 });
  let ended = false;
  lobby.onEnded(() => { ended = true; });
  try {
    await lobby.connect("网络验收");
    await delay(400);
    assert.equal(ended, false, "a pending original transport is recoverable");
    assert.equal(connections, 3);
    assert.equal(lobby.playerId, "local");
  } finally {
    lobby.disconnect(); for (const ws of wss.clients) ws.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  }
});
