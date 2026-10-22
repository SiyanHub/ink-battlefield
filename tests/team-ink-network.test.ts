import { test } from "node:test";
import assert from "node:assert/strict";
import type { Socket } from "node:net";
import { createGameServer } from "../src/server/server";
import { NetworkLobby } from "../src/session/network";
import { neutralInput, type GameEvent, type PaintSnapshot, type RoomSnapshot } from "../src/shared/contracts";
import { teamInk } from "../src/shared/ink";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean, explanation: string) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (condition()) return;
    await delay(5);
  }
  assert.fail(explanation);
}
const cells = (paint: PaintSnapshot) => paint.surfaces.flatMap(surface =>
  surface.cells.map(cell => [`${surface.id}:${cell[0]}`, cell[1], cell[2]] as const),
).sort((a, b) => a[0].localeCompare(b[0]));

test("real turf clients share two ink identities, reject one-team starts and restore all ink after transport loss", async () => {
  const server = await createGameServer({ port: 0 });
  const sockets: Socket[] = [];
  server.server.on("connection", socket => sockets.push(socket));
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const lobbies = Array.from({ length: 3 }, () => new NetworkLobby(url, undefined, { reconnectDelayMs: 350 }));
  const rooms: (RoomSnapshot | undefined)[] = [];
  const notices: string[][] = [[], [], []];
  const events: GameEvent[][] = [[], [], []];
  lobbies.forEach((lobby, i) => {
    lobby.subscribeRoom(room => rooms[i] = room);
    lobby.onError(message => notices[i].push(message));
    lobby.onSession(session => session.subscribe(frame => events[i].push(...frame.events)));
  });
  try {
    for (const [i, lobby] of lobbies.entries()) await lobby.connect(`墨色验收${i + 1}`);
    lobbies[0].create({ modeId: "turf", mapId: "construction", teamMode: false, maxPlayers: 3 });
    await until(() => !!rooms[0], "host must receive the room");
    assert.equal(rooms[0]!.settings.teamMode, true, "turf must force teams even if a client submits false");
    for (const lobby of lobbies.slice(1)) lobby.join(rooms[0]!.code);
    await until(() => rooms.every(room => room?.members.length === 3), "all clients must join");
    lobbies[0].choose("assault", ["rifle"], "blue");
    lobbies[1].choose("artist", ["pencil"], "blue");
    lobbies[2].choose("heavy", ["grenade"], "blue");
    lobbies.forEach(lobby => lobby.ready(true));
    await until(() => rooms[0]!.members.every(member => member.ready), "all peers must become ready");
    lobbies[0].start();
    await until(() => notices[0].some(message => message.includes("双方")), "a single team must be rejected");
    assert.equal(lobbies[0].getSession(), null);
    lobbies[2].choose("heavy", ["grenade"], "red");
    lobbies[2].ready(true);
    await until(() => rooms[0]!.members.some(member => member.teamId === "red" && member.ready), "red team must be ready");
    lobbies[0].start();
    await until(() => lobbies.every(lobby => !!lobby.getSession()), "all clients must enter the same match");
    const sessions = lobbies.map(lobby => lobby.getSession()!);
    for (const session of sessions) {
      const snapshot = session.getSnapshot();
      assert.ok(snapshot.remaining <= 240 && snapshot.remaining > 239, "the fresh room starts a four-minute match");
      assert.deepEqual(snapshot.scores, { blue: 0, red: 0 });
      assert.deepEqual(snapshot.actors.map(actor => [actor.teamId, actor.color]), [
        ["blue", teamInk.blue.color], ["blue", teamInk.blue.color], ["red", teamInk.red.color],
      ]);
    }
    sessions.forEach(session => session.submitInput({ ...neutralInput(), primary: true, pitch: 1.3 }));
    await until(() => sessions.every(session => {
      const ink = cells(session.getSnapshot().paint);
      return ink.some(cell => cell[2] === "blue") && ink.some(cell => cell[2] === "red");
    }), "both teams must paint geometry on every client");
    sessions.forEach(session => session.submitInput(neutralInput()));
    await until(() => sessions.every(session => session.getSnapshot().projectiles.length === 0), "all in-flight grenades must finish");
    await delay(100);
    const before = cells(sessions[0].getSnapshot().paint);
    assert.ok(before.length > 10);
    for (const [i, session] of sessions.entries()) {
      assert.deepEqual(cells(session.getSnapshot().paint), before, "clients reconstruct identical authoritative ink");
      for (const [playerIndex, lobby] of lobbies.entries()) {
        const shots = events[i].filter(event => event.type === "shot" && event.actorId === lobby.playerId);
        assert.ok(shots.length > 0, "each observer must receive every player's shot");
        assert.ok(shots.every(event => event.color === (playerIndex === 2 ? teamInk.red.color : teamInk.blue.color)));
      }
      assert.ok(before.every(cell => cell[1] === (cell[2] === "blue" ? teamInk.blue.color : teamInk.red.color)));
    }
    const previousSnapshot = sessions[0].getSnapshot();
    const previousPaint = structuredClone(previousSnapshot.paint);
    const identity = lobbies[0].playerId;
    sockets[0].destroy();
    await until(() => notices[0].some(message => message.includes("恢复连接")), "the disconnected client must begin recovery");
    sessions[1].submitInput({ ...neutralInput(), primary: true, pitch: 0.7, yaw: 0.8 });
    await delay(180);
    sessions[1].submitInput(neutralInput());
    await until(() => sockets.length >= 4 && rooms[0]!.members.every(member => member.connected), "the lost identity must reconnect");
    await until(() => cells(sessions[0].getSnapshot().paint).length > before.length, "full resync must include ink created during the outage");
    await delay(100);
    assert.equal(lobbies[0].playerId, identity);
    assert.equal(lobbies[0].getSession(), sessions[0], "a resume retains the running match session");
    assert.deepEqual(cells(sessions[0].getSnapshot().paint), cells(sessions[1].getSnapshot().paint));
    assert.deepEqual(cells(sessions[0].getSnapshot().paint), cells(sessions[2].getSnapshot().paint));
    assert.deepEqual(previousSnapshot.paint, previousPaint, "recovery cannot mutate an earlier published snapshot");
    const restoredKeys = new Set(cells(sessions[0].getSnapshot().paint).map(cell => cell[0]));
    assert.ok(before.every(cell => restoredKeys.has(cell[0])), "resume preserves every previously painted cell");
  } finally {
    lobbies.forEach(lobby => lobby.disconnect());
    await server.close();
  }
});
