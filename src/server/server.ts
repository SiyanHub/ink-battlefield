import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { acceptConnection, send } from "./connection";
import { RoomRegistry } from "./rooms";
import { startScheduler } from "./scheduler";
import { staticHttp } from "./static-http";
import type { GameServerOptions } from "./state";

/** Composition and ownership boundary: one listener, registry, and scheduler. */
export async function createGameServer(options: GameServerOptions = {}) {
  const server = createServer(staticHttp(options.distDir ?? "dist"));
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16384 });
  const rooms = new RoomRegistry(options, send);
  wss.on("connection", (ws) => acceptConnection(ws, rooms));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8903, options.host ?? "127.0.0.1", resolve);
  });
  const stopScheduler = startScheduler(rooms.activeRooms, send, rooms.broadcast);
  return {
    server,
    port: (server.address() as { port: number }).port,
    close: async () => {
      stopScheduler();
      rooms.dispose();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
