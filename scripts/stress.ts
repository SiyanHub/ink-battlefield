import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Simulation } from "../src/core/simulation";
import { modeRegistry } from "../src/core/modes";
import { maps } from "../src/content";
import { neutralInput } from "../src/shared/contracts";

const segments = 6,
  secondsPerSegment = 300,
  players = 8,
  ticksPerSegment = secondsPerSegment * 60;
modeRegistry.register({
  id: "stress-300",
  duration: secondsPerSegment,
  target: 0,
  title: "逻辑压力测试",
  update() {},
  onDeath() {},
});
const started = performance.now();
const results = [];
let globalMaxHeap = 0,
  globalMaxRss = 0;
for (let segment = 0; segment < segments; segment++) {
  const map = Object.values(maps)[segment % 3];
  const sim = new Simulation({
    modeId: "stress-300",
    map,
    seed: 100 + segment,
    teamMode: true,
  });
  for (let p = 0; p < players; p++)
    sim.addPlayer(
      `p${p}`,
      `玩家${p}`,
      "artist",
      [],
      p < 4 ? "red" : "blue",
      map.spawns[p],
    );
  let maxProjectiles = 0,
    maxActors = 0,
    maxCells = 0,
    maxFrameEvents = 0,
    maxSnapshotBytes = 0,
    maxHeap = 0,
    maxRss = 0;
  let paintEvents = 0,
    shots = 0,
    stepMs = 0;
  const segmentStart = performance.now();
  for (let tick = 0; tick < ticksPerSegment; tick++) {
    for (let p = 0; p < players; p++) {
      const angle = tick / 145 + p * 2.4;
      sim.input(`p${p}`, {
        ...neutralInput(),
        seq: tick,
        primary: true,
        moveX: Math.sin(angle),
        moveZ: Math.cos(angle),
        yaw: angle,
        slot: tick === 0 ? 2 : null,
      });
    }
    const before = performance.now();
    sim.step();
    stepMs += performance.now() - before;
    if (tick % 60 === 59) {
      const frame = sim.takeFrame(),
        snap = frame.snapshot;
      maxProjectiles = Math.max(maxProjectiles, snap.projectiles.length);
      maxActors = Math.max(maxActors, snap.actors.length);
      maxCells = Math.max(
        maxCells,
        snap.paint.surfaces.reduce((n, s) => n + s.cells.length, 0),
      );
      maxFrameEvents = Math.max(maxFrameEvents, frame.events.length);
      paintEvents += frame.events.filter((e) => e.type === "paint").length;
      shots += frame.events.filter((e) => e.type === "shot").length;
      if (tick % 300 === 299) {
        maxSnapshotBytes = Math.max(
          maxSnapshotBytes,
          Buffer.byteLength(JSON.stringify(snap)),
        );
        const usage = process.memoryUsage();
        maxHeap = Math.max(maxHeap, usage.heapUsed);
        maxRss = Math.max(maxRss, usage.rss);
      }
    }
  }
  const final = sim.getSnapshot();
  if (final.tick !== ticksPerSegment || final.phase !== "victory")
    throw new Error(`segment ${segment} did not finish`);
  if (maxProjectiles > 384 || maxActors > players || maxFrameEvents > 512)
    throw new Error(`segment ${segment} exceeded state cap`);
  const surfaceCellCapacity = map.surfaces.reduce(
    (n, s) =>
      n + Math.ceil(s.width / s.cellSize) * Math.ceil(s.height / s.cellSize),
    0,
  );
  if (maxCells > surfaceCellCapacity)
    throw new Error(`segment ${segment} exceeded paint grid`);
  globalMaxHeap = Math.max(globalMaxHeap, maxHeap);
  globalMaxRss = Math.max(globalMaxRss, maxRss);
  results.push({
    segment: segment + 1,
    mapId: map.id,
    simulatedSeconds: secondsPerSegment,
    ticks: final.tick,
    wallMs: Math.round(performance.now() - segmentStart),
    stepMs: Math.round(stepMs),
    paintEvents,
    shots,
    maxProjectiles,
    maxActors,
    maxCells,
    surfaceCellCapacity,
    maxFrameEvents,
    maxSnapshotBytes,
    maxHeapBytes: maxHeap,
    maxRssBytes: maxRss,
  });
  console.log(
    `${segment + 1}/${segments} ${map.id}: ${Math.round(performance.now() - segmentStart)} ms, ${maxCells} cells, ${paintEvents} paint events`,
  );
}
const report = {
  label:
    "Accelerated headless 60 Hz simulation; not a real-time GPU/browser FPS test",
  simulatedSeconds: segments * secondsPerSegment,
  totalTicks: segments * ticksPerSegment,
  playersPerSegment: players,
  maps: Object.keys(maps),
  wallMs: Math.round(performance.now() - started),
  hardware: {
    platform: process.platform,
    arch: process.arch,
    cpuCount: (await import("node:os")).cpus().length,
    node: process.version,
  },
  memory: {
    maxHeapBytes: globalMaxHeap,
    maxRssBytes: globalMaxRss,
    gcControlled: false,
  },
  segments: results,
};
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/stress.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    wallMs: report.wallMs,
    totalTicks: report.totalTicks,
    maxHeapBytes: globalMaxHeap,
    maxRssBytes: globalMaxRss,
  }),
);
