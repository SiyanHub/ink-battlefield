import { WebSocket } from "ws";
import { fail, parseMessage } from "./protocol";
import type { Member } from "./state";
import type { RoomRegistry } from "./rooms";

/** Socket backpressure is independent of room ownership and game rules. */
export function send(ws: WebSocket, message: object) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 1024 * 1024) {
    ws.close(1013, "Connection too slow");
    return;
  }
  ws.send(JSON.stringify(message));
}

/** Each connection owns its handshake deadline, rate window, and identity reference. */
export function acceptConnection(ws: WebSocket, rooms: RoomRegistry) {
  let member: Member | undefined;
  let count = 0;
  let windowStart = Date.now();
  const helloTimeout = setTimeout(() => ws.close(1008, "Hello required"), 5000);
  ws.on("error", () => {});
  ws.on("message", (raw) => {
    try {
      if (Date.now() - windowStart >= 1000) {
        windowStart = Date.now();
        count = 0;
      }
      if (++count > 150) {
        ws.close(1008, "Rate exceeded");
        return;
      }
      const message = parseMessage(raw.toString());
      if (message.type === "hello") {
        if (member) fail("已建立身份");
        member = rooms.identify(ws, message);
        clearTimeout(helloTimeout);
        send(ws, { type: "welcome", playerId: member.id, token: member.token });
        if (member.room) {
          rooms.broadcast(member.room);
          rooms.full(member);
        }
        return;
      }
      if (!member) fail("请先建立身份");
      if (message.type === "leave") {
        rooms.remove(member);
        member = undefined;
        send(ws, { type: "left" });
        return;
      }
      rooms.handle(member, message);
    } catch (error) {
      send(ws, {
        type: "error",
        message: error instanceof Error ? error.message : "非法消息",
      });
    }
  });
  ws.on("close", () => {
    clearTimeout(helloTimeout);
    if (member?.ws === ws) rooms.disconnect(member);
  });
}
