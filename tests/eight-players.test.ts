import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createGameServer } from "../src/server/server";
import { Simulation } from "../src/core/simulation";
import { neutralInput } from "../src/shared/contracts";

test("eight real peers receive the same authoritative paint events scores and final turf result", async () => {
  const server = await createGameServer({
    port: 0,
    createSimulation: (settings) => {
      const s = new Simulation(settings);
      s.advance(238.5);
      return s;
    },
  });
  const peers = Array.from({ length: 8 }, () => ({
    ws: new WebSocket(`ws://127.0.0.1:${server.port}/ws`),
    messages: [] as any[],
    frames: new Map<number, any>(),
    paints: new Map<string, unknown>(),
  }));
  const wait = async (p: (typeof peers)[number], type: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const i = p.messages.findIndex((m) => m.type === type);
      if (i >= 0) return p.messages.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 5));
    }
    throw Error(`waiting for ${type}`);
  };
  const send = (p: (typeof peers)[number], m: object) =>
    p.ws.send(JSON.stringify(m));
  try {
    await Promise.all(
      peers.map(
        (p, i) =>
          new Promise<void>((resolve) => {
            p.ws.on("message", (data) => {
              const m = JSON.parse(data.toString());
              p.messages.push(m);
              if (m.type === "frame") {
                p.frames.set(m.frame.snapshot.tick, m.frame.snapshot);
                for (const e of m.frame.events)
                  if (e.type === "paint")
                    for (const c of e.cells ?? [])
                      p.paints.set(`${e.surfaceId}:${c[0]}`, c);
              }
            });
            p.ws.on("open", () => {
              send(p, { type: "hello", name: `验收${i + 1}` });
              resolve();
            });
          }),
      ),
    );
    await Promise.all(peers.map((p) => wait(p, "welcome")));
    send(peers[0], {
      type: "create",
      settings: {
        modeId: "turf",
        mapId: "construction",
        teamMode: true,
        maxPlayers: 8,
      },
    });
    const code = (await wait(peers[0], "room")).room.code;
    for (let i = 1; i < 8; i++) {
      send(peers[i], { type: "join", code });
      await wait(peers[i], "room");
    }
    for (let i = 0; i < 8; i++) {
      send(peers[i], {
        type: "choose",
        classId: "artist",
        weapons: ["pencil"],
        teamId: i < 4 ? "red" : "blue",
      });
      send(peers[i], { type: "ready", ready: true });
    }
    await new Promise((r) => setTimeout(r, 40));
    send(peers[0], { type: "start" });
    const starts = await Promise.all(peers.map((p) => wait(p, "start")));
    assert.ok(
      starts.every(
        (s) =>
          s.frame.snapshot.actors.length === 8 &&
          s.matchId === starts[0].matchId,
      ),
    );
    peers.forEach((p) =>
      send(p, {
        type: "input",
        input: { ...neutralInput(), seq: 1, pitch: 1.3, primary: true },
      }),
    );
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      !peers.every((p) =>
        [...p.frames.values()].some((s) => s.phase === "victory"),
      )
    )
      await new Promise((r) => setTimeout(r, 10));
    const results = peers.map((p) =>
      [...p.frames.values()].find((s) => s.phase === "victory"),
    );
    assert.ok(results.every(Boolean));
    assert.ok(Object.keys(results[0].scores).length === 2);
    for (let i = 1; i < 8; i++) {
      assert.deepEqual(results[i].scores, results[0].scores);
      assert.equal(results[i].winner, results[0].winner);
      assert.deepEqual(
        [...peers[i].paints].sort(),
        [...peers[0].paints].sort(),
      );
    }
    assert.ok(peers[0].paints.size > 30);
  } finally {
    peers.forEach((p) => p.ws.terminate());
    await server.close();
  }
});
