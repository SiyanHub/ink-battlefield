import type { Room, SendMessage } from "./state";

/** Consume one ordered input per player at 60Hz and publish every third step. */
export function startScheduler(
  rooms: () => Iterable<Room>,
  send: SendMessage,
  broadcast: (room: Room) => void,
) {
  const timer = setInterval(() => {
    const now = performance.now();
    for (const r of rooms()) {
      if (!r.simulation || r.snapshot.status !== "playing") continue;
      r.accumulator += Math.min(0.25, (now - r.last) / 1000);
      r.last = now;
      while (r.accumulator >= 1 / 60) {
        for (const player of r.members) {
          if (!player.inputReleased && now - player.lastInputAt > 500) {
            player.inputs = [];
            player.inputReleased = true;
            r.simulation.releaseInput(player.id);
          }
          const next = player.inputs.shift();
          if (next) r.simulation.input(player.id, next);
        }
        r.simulation.step();
        r.accumulator -= 1 / 60;
        r.broadcastTicks++;
        if (r.broadcastTicks % 3 === 0) {
          const frame = r.simulation.takeFrame(false);
          for (const p of r.members)
            send(p.ws, {
              type: "frame",
              matchId: r.matchId,
              frame,
              ack: r.simulation.acknowledgedInput(p.id),
            });
          if (
            frame.snapshot.phase === "victory" ||
            frame.snapshot.phase === "defeat"
          ) {
            r.snapshot.status = "finished";
            broadcast(r);
            break;
          }
        }
      }
    }
  }, 8);
  return () => clearInterval(timer);
}
