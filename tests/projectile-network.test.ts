import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameServer } from "../src/server/server";
import { NetworkLobby } from "../src/session/network";
import { Simulation } from "../src/core/simulation";
import { maps, weapons } from "../src/content";
import { neutralInput, type GameEvent, type GameFrame, type RoomSnapshot } from "../src/shared/contracts";

async function until(condition: () => boolean, message: string) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test("real 20 Hz clients receive an immutable birth and end for ink that finishes between snapshots", async () => {
  const base = maps.construction;
  const server = await createGameServer({ port: 0, createSimulation: settings => new Simulation({
    ...settings, map: { ...base, boxes: [base.boxes[0]], surfaces: base.surfaces.filter(surface => surface.boxId === "ground"),
      spawns: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1.2 }] },
    content: { weapons: { rifle: { ...weapons.rifle, automatic: false, spread: 0 } } },
  }) });
  const lobbies = [new NetworkLobby(`ws://127.0.0.1:${server.port}/ws`), new NetworkLobby(`ws://127.0.0.1:${server.port}/ws`)];
  const rooms: (RoomSnapshot | undefined)[] = [];
  const frames: GameFrame[][] = [[], []];
  lobbies.forEach((lobby, index) => {
    lobby.subscribeRoom(room => rooms[index] = room);
    lobby.onSession(session => session.subscribe(frame => frames[index].push(frame)));
  });
  try {
    await lobbies[0].connect("近距射手"); await lobbies[1].connect("近距目标");
    lobbies[0].create({ modeId: "deathmatch", mapId: "construction", teamMode: false, maxPlayers: 2 });
    await until(() => !!rooms[0], "host must receive its room");
    lobbies[1].join(rooms[0]!.code);
    await until(() => rooms.every(room => room?.members.length === 2), "both peers must join");
    lobbies.forEach(lobby => lobby.ready(true));
    await until(() => rooms[0]!.members.every(member => member.ready), "both peers must be ready");
    lobbies[0].start();
    await until(() => lobbies.every(lobby => (lobby.getSession()?.getSnapshot().time ?? 0) >= 2), "spawn protection must expire");
    const shooter = lobbies[0].playerId, target = lobbies[1].playerId;
    lobbies[0].getSession()!.submitInput({ ...neutralInput(), primary: true });
    await until(() => frames.every(peer => peer.some(frame => frame.events.some(event => event.type === "hit" && event.actorId === shooter))), "the real input must hit the close target");
    lobbies[0].getSession()!.submitInput(neutralInput());
    const received: GameEvent[][] = [];
    for (const peer of frames) {
      const events = peer.flatMap(frame => frame.events);
      assert.ok(peer.every(frame => frame.snapshot.projectiles.every(projectile => projectile.ownerId !== shooter)), "fixture must finish before every network snapshot");
      const births = events.filter(event => event.type === "projectile" && event.projectile?.ownerId === shooter);
      assert.equal(births.length, 1, "short-lived ink still needs an authoritative flight record");
      const birth = births[0].projectile!;
      const ends = events.filter(event => event.type === "projectile-end" && event.projectileId === birth.id);
      assert.equal(ends.length, 1);
      assert.deepEqual(birth.pos, { x: 0, y: 1.62, z: 0 }, "birth must not alias the subsequently moved runtime projectile");
      assert.equal(birth.vel.z, -weapons.rifle.speed!);
      assert.ok(ends[0].pos!.z < -.5 && ends[0].pos!.z > -1.2);
      assert.ok(births[0].id < ends[0].id);
      assert.equal(events.filter(event => event.type === "shot" && event.actorId === shooter).length, 1);
      assert.equal(events.filter(event => event.type === "hit" && event.targetId === target).length, 1, "presentation records must not duplicate damage");
      received.push([births[0], ends[0]]);
    }
    assert.deepEqual(received[0], received[1], "both peers receive the same authoritative segment");
  } finally {
    lobbies.forEach(lobby => lobby.disconnect());
    await server.close();
  }
});
