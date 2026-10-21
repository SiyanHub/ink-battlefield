import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createGameServer } from "../src/server/server";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
class Peer {
  ws: WebSocket;
  opened: Promise<void>;
  messages: any[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((r) => this.ws.once("open", r));
    this.ws.on("message", (d) => this.messages.push(JSON.parse(d.toString())));
  }
  async wait(type: string) {
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      const i = this.messages.findIndex((m) => m.type === type);
      if (i >= 0) return this.messages.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 5));
    }
    throw Error(`Timed out ${type}`);
  }
  send(message: object) {
    this.ws.send(JSON.stringify(message));
  }
  async hello() {
    await this.opened;
    this.send({ type: "hello", name: "同名玩家" });
    return this.wait("welcome");
  }
}
test("objective rooms always use teams on create and configure", async () => {
  const server = await createGameServer({ port: 0 });
  const a = new Peer(`ws://127.0.0.1:${server.port}/ws`);
  try {
    await a.hello();
    a.send({
      type: "create",
      settings: {
        modeId: "control",
        mapId: "construction",
        teamMode: false,
        maxPlayers: 2,
      },
    });
    assert.equal((await a.wait("room")).room.settings.teamMode, true);
    a.send({ type: "configure", settings: { teamMode: false } });
    assert.equal((await a.wait("room")).room.settings.teamMode, true);
    a.send({
      type: "configure",
      settings: { modeId: "deathmatch", teamMode: false },
    });
    assert.equal((await a.wait("room")).room.settings.teamMode, false);
    a.send({
      type: "configure",
      settings: { modeId: "turf", teamMode: false },
    });
    assert.equal((await a.wait("room")).room.settings.teamMode, true);
  } finally {
    a.ws.terminate();
    await server.close();
  }
});
test("two real sockets create, ready and start an authoritative match", async () => {
  const server = await createGameServer({ port: 0, host: "127.0.0.1" });
  const a = new Peer(`ws://127.0.0.1:${server.port}/ws`),
    b = new Peer(`ws://127.0.0.1:${server.port}/ws`);
  try {
    const wa = await a.hello(),
      wb = await b.hello();
    assert.notEqual(wa.playerId, wb.playerId);
    a.send({
      type: "create",
      settings: {
        modeId: "deathmatch",
        mapId: "construction",
        teamMode: false,
        maxPlayers: 8,
      },
    });
    const room = (await a.wait("room")).room;
    b.send({ type: "join", code: room.code });
    await b.wait("room");
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await new Promise((r) => setTimeout(r, 30));
    a.send({ type: "start" });
    const start = await a.wait("start");
    assert.equal(start.frame.snapshot.actors.length, 2);
    assert.ok(start.frame.snapshot.paint);
    assert.equal((await b.wait("start")).matchId, start.matchId);
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    await server.close();
  }
});

test("room validates capacity, host authority and class choices", async () => {
  const server = await createGameServer({ port: 0 });
  const peers = Array.from(
    { length: 9 },
    () => new Peer(`ws://127.0.0.1:${server.port}/ws`),
  );
  try {
    await Promise.all(peers.map((p) => p.hello()));
    peers[0].send({
      type: "create",
      settings: {
        modeId: "deathmatch",
        mapId: "construction",
        teamMode: false,
        maxPlayers: 8,
      },
    });
    const { room } = await peers[0].wait("room");
    for (let i = 1; i < 8; i++) {
      peers[i].send({ type: "join", code: room.code });
      await peers[i].wait("room");
    }
    peers[8].send({ type: "join", code: room.code });
    assert.ok((await peers[8].wait("error")).message);
    peers[1].send({ type: "start" });
    assert.ok((await peers[1].wait("error")).message);
    peers[1].send({ type: "choose", classId: "god", weapons: [] });
    assert.ok((await peers[1].wait("error")).message);
  } finally {
    peers.forEach((p) => p.ws.terminate());
    await server.close();
  }
});
test("temporary disconnect resumes identity and state, explicit leave transfers host", async () => {
  const server = await createGameServer({ port: 0, reconnectMs: 300 });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const a = new Peer(url),
    b = new Peer(url);
  let c: Peer | undefined;
  try {
    const wa = await a.hello();
    await b.hello();
    a.send({
      type: "create",
      settings: {
        modeId: "deathmatch",
        mapId: "construction",
        teamMode: false,
        maxPlayers: 2,
      },
    });
    const { room } = await a.wait("room");
    b.send({ type: "join", code: room.code });
    await b.wait("room");
    a.ws.terminate();
    await new Promise((r) => setTimeout(r, 30));
    c = new Peer(url);
    await c.opened;
    c.send({ type: "hello", name: "恢复", token: wa.token });
    assert.equal((await c.wait("welcome")).playerId, wa.playerId);
    assert.equal((await c.wait("room")).room.code, room.code);
    c.send({ type: "leave" });
    await c.wait("left");
    let transferred: any;
    for (let i = 0; i < 8; i++) {
      transferred = (await b.wait("room")).room;
      if (transferred.members.length === 1) break;
    }
    assert.equal(transferred.hostId, transferred.members[0].id);
    assert.notEqual(transferred.hostId, wa.playerId);
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    c?.ws.terminate();
    await server.close();
  }
});
test("match rejects forged damage and malformed inputs, acknowledges valid input and restores full state", async () => {
  const server = await createGameServer({ port: 0 });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const a = new Peer(url),
    b = new Peer(url);
  let c: Peer | undefined;
  try {
    const wa = await a.hello();
    await b.hello();
    a.send({
      type: "create",
      settings: {
        modeId: "deathmatch",
        mapId: "construction",
        teamMode: false,
        maxPlayers: 2,
      },
    });
    const { room } = await a.wait("room");
    b.send({ type: "join", code: room.code });
    await b.wait("room");
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await new Promise((r) => setTimeout(r, 25));
    a.send({ type: "start" });
    const start = await a.wait("start");
    await b.wait("start");
    const good = {
      seq: 1,
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
    };
    a.send({ type: "input", input: { ...good, damage: 99999 } });
    await a.wait("error");
    a.send({ type: "input", input: { ...good, primary: "yes" } });
    await a.wait("error");
    a.send({ type: "input", input: good });
    let update: any;
    do {
      update = await a.wait("frame");
    } while (update.ack < 1);
    assert.equal(update.frame.snapshot.paint, undefined);
    assert.equal(
      update.frame.snapshot.actors.find((p: any) => p.id !== wa.playerId).hp,
      start.frame.snapshot.actors.find((p: any) => p.id !== wa.playerId).hp,
    );
    a.send({ type: "input", input: { ...good, moveX: 1 } });
    await new Promise((r) => setTimeout(r, 80));
    const duplicate = await a.wait("frame");
    assert.equal(duplicate.ack, 1);
    a.send({
      type: "input",
      input: { ...good, seq: 2, pitch: 1.3, primary: true },
    });
    let ink: any;
    do {
      ink = await a.wait("frame");
    } while (
      !ink.frame.events.some((e: any) => e.type === "paint" && e.cells?.length)
    );
    a.ws.terminate();
    await new Promise((r) => setTimeout(r, 30));
    c = new Peer(url);
    await c.opened;
    c.send({ type: "hello", name: "恢复", token: wa.token });
    await c.wait("welcome");
    const restored = await c.wait("start");
    assert.equal(restored.matchId, start.matchId);
    assert.ok(
      restored.frame.snapshot.paint.surfaces.some(
        (s: any) => s.cells.length > 0,
      ),
    );
    assert.equal(restored.frame.snapshot.actors.length, 2);
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    c?.ws.terminate();
    await server.close();
  }
});
test("HTTP serves only dist and rejects traversal and source paths", async () => {
  const server = await createGameServer({ port: 0 });
  try {
    for (const path of [
      "/src/core/simulation.ts",
      "/.env",
      "/%2e%2e/package.json",
      "/..%5cpackage.json",
    ]) {
      const result = await fetch(`http://127.0.0.1:${server.port}${path}`);
      assert.ok([403, 404].includes(result.status));
    }
  } finally {
    await server.close();
  }
});
test("HTTP cannot follow a dist directory junction to files outside dist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ink-server-http-"));
  const dist = join(directory, "dist");
  const outside = join(directory, "private");
  await mkdir(dist);
  await mkdir(outside);
  await writeFile(join(dist, "index.html"), "public game");
  await writeFile(join(outside, "secret.txt"), "private project data");
  await symlink(outside, join(dist, "linked"), "junction");
  const server = await createGameServer({ port: 0, distDir: dist });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    assert.equal(await (await fetch(base)).text(), "public game");
    const result = await fetch(`${base}/linked/secret.txt`);
    assert.equal(result.status, 403);
    assert.ok(!(await result.text()).includes("private project data"));
  } finally {
    await server.close();
    assert.ok(directory.startsWith(join(tmpdir(), "ink-server-http-")));
    await rm(directory, { recursive: true, force: true });
  }
});
test("finished matches rematch to an unready lobby before a new session", async () => {
  const { Simulation } = await import("../src/core/simulation");
  const server = await createGameServer({
    port: 0,
    createSimulation: (settings: any) => {
      const simulation = new Simulation(settings);
      simulation.advance(359.9);
      return simulation;
    },
  } as any);
  const a = new Peer(`ws://127.0.0.1:${server.port}/ws`),
    b = new Peer(`ws://127.0.0.1:${server.port}/ws`);
  try {
    await a.hello();
    await b.hello();
    a.send({
      type: "create",
      settings: {
        modeId: "deathmatch",
        mapId: "construction",
        teamMode: false,
        maxPlayers: 2,
      },
    });
    const { room } = await a.wait("room");
    b.send({ type: "join", code: room.code });
    await b.wait("room");
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await new Promise((r) => setTimeout(r, 25));
    a.send({ type: "start" });
    const first = await a.wait("start");
    let current: any;
    do {
      current = (await a.wait("room")).room;
    } while (current.status !== "finished");
    a.send({
      type: "input",
      input: { ...neutralInput(), seq: 99, primary: true },
    });
    a.send({ type: "rematch" });
    const lobby = (await a.wait("room")).room;
    assert.equal(
      a.messages.filter((m) => m.type === "error").length,
      0,
      "in-flight input after the final frame is harmless",
    );
    assert.equal(lobby.status, "lobby");
    assert.ok(lobby.members.every((p: any) => !p.ready));
    a.send({ type: "start" });
    await a.wait("error");
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await new Promise((r) => setTimeout(r, 25));
    a.send({ type: "start" });
    assert.notEqual((await a.wait("start")).matchId, first.matchId);
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    await server.close();
  }
});
test("client session predicts local movement and keeps the room socket when disposed", async () => {
  const { NetworkLobby } = await import("../src/session/network");
  const oldRaf = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (fn: FrameRequestCallback) =>
    setTimeout(() => fn(performance.now()), 16) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
  const server = await createGameServer({ port: 0 });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const lobby = new NetworkLobby(url),
    b = new Peer(url);
  try {
    await lobby.connect("预测玩家");
    await b.hello();
    const roomPromise = new Promise<any>((r) => lobby.subscribeRoom(r));
    lobby.create({
      modeId: "deathmatch",
      mapId: "construction",
      teamMode: false,
      maxPlayers: 2,
    });
    const room = await roomPromise;
    b.send({ type: "join", code: room.code });
    await b.wait("room");
    lobby.ready(true);
    b.send({ type: "ready", ready: true });
    await new Promise((r) => setTimeout(r, 25));
    const sessionPromise = new Promise<any>((r) => lobby.onSession(r));
    lobby.start();
    const session = await sessionPromise;
    await b.wait("start");
    assert.ok(session.getSnapshot().paint);
    const before = structuredClone(
      session.getSnapshot().actors.find((a: any) => a.id === lobby.playerId),
    );
    session.submitInput({
      seq: 1,
      moveX: 1,
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
    await new Promise((r) => setTimeout(r, 25));
    const after = session
      .getSnapshot()
      .actors.find((a: any) => a.id === lobby.playerId);
    assert.ok(after.pos.x > before.pos.x);
    session.dispose();
    const error = new Promise<string>((r) => lobby.onError(r));
    lobby.configure({ maxPlayers: 3 });
    assert.ok(await error);
  } finally {
    lobby.disconnect();
    b.ws.terminate();
    await server.close();
    globalThis.requestAnimationFrame = oldRaf;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test("expired reconnect credentials are rejected and host passes to a connected member", async () => {
  const server = await createGameServer({ port: 0, reconnectMs: 80 });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const a = new Peer(url),
    b = new Peer(url);
  let c: Peer | undefined;
  try {
    const wa = await a.hello(),
      wb = await b.hello();
    a.send({
      type: "create",
      settings: {
        modeId: "deathmatch",
        mapId: "construction",
        teamMode: false,
        maxPlayers: 2,
      },
    });
    const { room } = await a.wait("room");
    b.send({ type: "join", code: room.code });
    await b.wait("room");
    a.ws.terminate();
    let current: any;
    do {
      current = (await b.wait("room")).room;
    } while (current.members.length !== 1);
    assert.equal(current.hostId, wb.playerId);
    c = new Peer(url);
    await c.opened;
    c.send({ type: "hello", name: "过期", token: wa.token });
    await c.wait("error");
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    c?.ws.terminate();
    await server.close();
  }
});
test("oversized WebSocket messages and excessive message rates close the offending socket", async () => {
  const server = await createGameServer({ port: 0 });
  const a = new Peer(`ws://127.0.0.1:${server.port}/ws`),
    b = new Peer(`ws://127.0.0.1:${server.port}/ws`);
  try {
    await a.hello();
    await b.hello();
    const closedA = new Promise<number>((r) => a.ws.once("close", r));
    a.send({ type: "unknown", payload: "x".repeat(17000) });
    assert.equal(await closedA, 1009);
    const closedB = new Promise<number>((r) => b.ws.once("close", r));
    for (let i = 0; i < 155; i++) b.send({ type: "unknown" });
    assert.equal(await closedB, 1008);
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    await server.close();
  }
});
test("rejected duplicate resume token cannot leave or configure the authenticated host", async () => {
  const server = await createGameServer({ port: 0 });
  const url = `ws://127.0.0.1:${server.port}/ws`,
    a = new Peer(url),
    b = new Peer(url);
  try {
    const wa = await a.hello();
    a.send({
      type: "create",
      settings: {
        modeId: "deathmatch",
        mapId: "construction",
        teamMode: false,
        maxPlayers: 2,
      },
    });
    const room = (await a.wait("room")).room;
    await b.opened;
    b.send({ type: "hello", name: "duplicate", token: wa.token });
    await b.wait("error");
    b.send({ type: "leave" });
    await b.wait("error");
    a.send({ type: "configure", settings: { maxPlayers: 3 } });
    assert.equal((await a.wait("room")).room.settings.maxPlayers, 3);
    assert.equal(room.hostId, wa.playerId);
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    await server.close();
  }
});
import { WebSocketServer } from "ws";
import { Simulation } from "../src/core/simulation";
import { NetworkLobby } from "../src/session/network";
import { neutralInput } from "../src/shared/contracts";
class Clock {
  time = 0;
  listeners = new Set<() => void>();
  now = () => this.time;
  setInterval = (fn: () => void) => {
    this.listeners.add(fn);
    return fn;
  };
  clearInterval = (id: unknown) => {
    this.listeners.delete(id as () => void);
  };
  advance(ms: number) {
    this.time += ms;
    for (const fn of this.listeners) fn();
  }
}
async function clientWire() {
  globalThis.requestAnimationFrame ??= (fn: FrameRequestCallback) =>
    setTimeout(() => fn(performance.now()), 16) as unknown as number;
  globalThis.cancelAnimationFrame ??= (id: number) => clearTimeout(id);
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", r));
  const messages: any[] = [];
  let socket: WebSocket;
  wss.on("connection", (ws) => {
    socket = ws;
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      messages.push(m);
      if (m.type === "hello")
        ws.send(
          JSON.stringify({
            type: "welcome",
            playerId: "local",
            token: "opaque",
          }),
        );
    });
  });
  const clock = new Clock(),
    lobby = new NetworkLobby(
      `ws://127.0.0.1:${(wss.address() as any).port}`,
      clock as any,
    );
  await lobby.connect("test");
  const simulation = new Simulation({ modeId: "deathmatch" });
  simulation.addPlayer("local", "local", "assault");
  simulation.addPlayer("remote", "remote", "assault");
  const snapshot = simulation.getSnapshot();
  const sessionReady = new Promise<any>((r) => lobby.onSession(r));
  socket!.send(
    JSON.stringify({
      type: "start",
      matchId: "one",
      frame: { snapshot, events: [] },
      ack: -1,
    }),
  );
  const session = await sessionReady;
  return {
    clock,
    lobby,
    session,
    snapshot,
    messages,
    endConnection: () => socket!.close(4000, "Session ended"),
    send: async (m: object) => {
      socket!.send(JSON.stringify(m));
      await new Promise((r) => setTimeout(r, 10));
    },
    close: async () => {
      lobby.disconnect();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
test("240 render samples send only fixed 60Hz steps and latch one-shot controls", async () => {
  const f = await clientWire();
  try {
    for (let n = 0; n < 240; n++) {
      f.session.submitInput({ ...neutralInput(), moveX: 1, jump: n === 0 });
      f.clock.advance(1000 / 240);
    }
    await new Promise((r) => setTimeout(r, 30));
    const inputs = f.messages.filter((m) => m.type === "input");
    assert.ok(
      inputs.length >= 59 && inputs.length <= 60,
      `sent ${inputs.length}`,
    );
    assert.equal(inputs[0].input.jump, true);
    assert.ok(inputs.slice(1).every((m) => !m.input.jump));
  } finally {
    await f.close();
  }
});

test("finished sessions send no input despite continued render sampling", async () => {
  const f = await clientWire();
  try {
    await f.send({
      type: "frame",
      matchId: "one",
      ack: 0,
      frame: { snapshot: { ...f.snapshot, phase: "victory" }, events: [] },
    });
    for (let n = 0; n < 240; n++) {
      f.session.submitInput(neutralInput());
      f.clock.advance(1000 / 240);
    }
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(f.messages.filter((m) => m.type === "input").length, 0);
  } finally {
    await f.close();
  }
});
test("server consumes ordered input steps without losing a short jump press", async () => {
  const server = await createGameServer({ port: 0 }),
    a = new Peer(`ws://127.0.0.1:${server.port}/ws`),
    b = new Peer(`ws://127.0.0.1:${server.port}/ws`);
  try {
    const wa = await a.hello();
    await b.hello();
    a.send({
      type: "create",
      settings: {
        modeId: "deathmatch",
        mapId: "construction",
        teamMode: false,
        maxPlayers: 2,
      },
    });
    b.send({ type: "join", code: (await a.wait("room")).room.code });
    await b.wait("room");
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await new Promise((r) => setTimeout(r, 25));
    a.send({ type: "start" });
    await a.wait("start");
    a.send({ type: "input", input: { ...neutralInput(), seq: 1, jump: true } });
    a.send({
      type: "input",
      input: { ...neutralInput(), seq: 2, jump: false },
    });
    let frame: any;
    do {
      frame = await a.wait("frame");
    } while (frame.ack < 2);
    assert.ok(
      frame.frame.snapshot.actors.find((p: any) => p.id === wa.playerId).pos.y >
        0.05,
    );
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    await server.close();
  }
});
test("rematch room notification exposes no old session and keeps the lobby connected", async () => {
  const f = await clientWire();
  try {
    let observed: any = "not notified";
    f.lobby.subscribeRoom(() => {
      observed = f.lobby.getSession();
    });
    await f.send({
      type: "room",
      room: {
        code: "ABC",
        hostId: "local",
        status: "lobby",
        settings: {
          modeId: "deathmatch",
          mapId: "construction",
          teamMode: false,
          maxPlayers: 2,
        },
        members: [],
      },
    });
    assert.equal(observed, null);
    f.lobby.ready(true);
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(f.messages.some((m) => m.type === "ready"));
  } finally {
    await f.close();
  }
});
test("getSnapshot used by renderer.draw contains intermediate remote positions and reaches the target", async () => {
  const f = await clientWire();
  try {
    const old = f.snapshot.actors.find((a) => a.id === "remote")!.pos.x;
    const next = structuredClone(f.snapshot);
    next.actors.find((a) => a.id === "remote")!.pos.x += 2;
    await f.send({
      type: "frame",
      matchId: "one",
      ack: 0,
      frame: { snapshot: next, events: [] },
    });
    f.clock.advance(25);
    const renderX = f.session
      .getSnapshot()
      .actors.find((a: any) => a.id === "remote").pos.x;
    assert.ok(renderX > old && renderX < old + 2, `render x ${renderX}`);
    f.clock.advance(25);
    assert.equal(
      f.session.getSnapshot().actors.find((a: any) => a.id === "remote").pos.x,
      old + 2,
    );
  } finally {
    await f.close();
  }
});

test("30 60 120 and 240Hz sampling predict the same one-second movement", async () => {
  const positions: number[] = [];
  for (const hz of [30, 60, 120, 240]) {
    const f = await clientWire();
    try {
      for (let n = 0; n < hz; n++) {
        f.session.submitInput({ ...neutralInput(), moveX: 1 });
        f.clock.advance(1000 / hz);
      }
      positions.push(
        f.session.getSnapshot().actors.find((a: any) => a.id === "local").pos.x,
      );
    } finally {
      await f.close();
    }
  }
  assert.ok(
    Math.max(...positions) - Math.min(...positions) < 0.000001,
    positions.join(","),
  );
});
test("client submits only distinct equipped weapons for room choice and respawn", async () => {
  const f = await clientWire();
  try {
    f.lobby.choose("assault", ["pencil", "", "pencil", "eraser"]);
    f.session.command({
      type: "respawn",
      classId: "assault",
      weapons: ["pencil", "", "pencil", "eraser"],
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(f.messages.find((m) => m.type === "choose").weapons, [
      "pencil",
      "eraser",
    ]);
    assert.deepEqual(
      f.messages.find((m) => m.type === "command").command.weapons,
      ["pencil", "eraser"],
    );
  } finally {
    await f.close();
  }
});
test("hidden page releases held movement and fire without losing aim", async () => {
  const original = globalThis.document;
  const page = new EventTarget() as Document & { hidden: boolean };
  page.hidden = false;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: page,
  });
  const f = await clientWire();
  try {
    f.session.submitInput({
      ...neutralInput(),
      moveX: 1,
      moveZ: -1,
      yaw: 1.2,
      pitch: -0.3,
      primary: true,
      secondary: true,
      sprint: true,
    });
    f.clock.advance(1000 / 60);
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    f.clock.advance(1000 / 60);
    await new Promise((r) => setTimeout(r, 20));
    const inputs = f.messages.filter((m) => m.type === "input");
    assert.ok(inputs.length >= 2);
    assert.equal(inputs.at(-1).input.moveX, 0);
    assert.equal(inputs.at(-1).input.moveZ, 0);
    assert.equal(inputs.at(-1).input.primary, false);
    assert.equal(inputs.at(-1).input.secondary, false);
    assert.equal(inputs.at(-1).input.sprint, false);
    assert.equal(inputs.at(-1).input.yaw, 1.2);
    assert.equal(inputs.at(-1).input.pitch, -0.3);
  } finally {
    await f.close();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: original,
    });
  }
});
test("explicit server end clears the public session and announces a terminal reason", async () => {
  const f = await clientWire();
  try {
    let ended = "";
    const done = new Promise<void>((resolve) =>
      f.lobby.onEnded((reason: string) => {
        ended = reason;
        assert.equal(f.lobby.getSession(), null);
        resolve();
      }),
    );
    f.endConnection();
    await done;
    assert.match(ended, /会话已结束/);
    f.session.submitInput({ ...neutralInput(), primary: true });
    f.clock.advance(1000 / 60);
    assert.equal(f.lobby.getSession(), null);
  } finally {
    await f.close();
  }
});
