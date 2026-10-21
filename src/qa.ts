import { Renderer } from "./client/renderer";
import { Simulation } from "./core/simulation";
import { PaintField } from "./core/paint";
import { modeRegistry } from "./core/modes";
import { maps } from "./content";
import type { GameFrame, PaintSnapshot } from "./shared/contracts";
import { Vector3 } from "three";
import { checkPaintPixels } from "./qa-raster-check";

const $ = (id: string) => document.getElementById(id)!;
const canvas = $("game") as HTMLCanvasElement;
const out = $("metrics");
const view = new Renderer(canvas, () => ({
  sensitivity: 1,
  volume: 0,
  quality: "medium",
  reduceMotion: true,
}));
const gl = view.renderer.getContext();
const debugRenderer = gl.getExtension("WEBGL_debug_renderer_info");
const hardware = {
  renderer: debugRenderer
    ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER),
  userAgent: navigator.userAgent,
  quality: "medium",
};
const mapIds = Object.keys(maps);
const initialPaint = new Map<string, PaintSnapshot>();
function fullInk(mapId: string): PaintSnapshot {
  const cached = initialPaint.get(mapId);
  if (cached) return cached;
  const map = maps[mapId],
    field = new PaintField(map.surfaces, map.boxes);
  for (const s of map.surfaces) {
    const cols = Math.ceil(s.width / s.cellSize),
      rows = Math.ceil(s.height / s.cellSize);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const u = (x + 0.5) * s.cellSize - s.width / 2;
        const v = (y + 0.5) * s.cellSize - s.height / 2;
        field.stamp(
          s.id,
          {
            x: s.center.x + s.u.x * u + s.v.x * v,
            y: s.center.y + s.u.y * u + s.v.y * v,
            z: s.center.z + s.u.z * u + s.v.z * v,
          },
          s.cellSize * 0.72,
          "qa",
          (x + y) % 2 ? 0x44bda7 : 0xe9b13b,
        );
      }
  }
  const snapshot = field.snapshot();
  initialPaint.set(mapId, snapshot);
  return snapshot;
}
modeRegistry.register({
  id: "qa-soak",
  duration: 86400,
  target: 0,
  title: "QA soak",
  update() {},
  onDeath() {},
});
let sim: Simulation;
let lastFrame: GameFrame;
let resets = 0,
  start = 0,
  end = 0,
  previous = 0,
  accumulator = 0,
  duration = 0,
  running = false;
let nextResetAt = 0,
  resetOnly = false,
  inputSeq = 0,
  totalTicks = 0,
  valid = true;
let rafCount = 0,
  rafTotalMs = 0;
let maxFrameMs = 0,
  longFrames = 0,
  hiddenDuringRun = false;
let frameTimes: number[] = [];
let resetSamples: object[] = [];
let status = "ready";
let finalMetrics: ReturnType<typeof metrics> | null = null;
document.addEventListener("visibilitychange", () => {
  if (running && document.visibilityState !== "visible") {
    valid = false;
    hiddenDuringRun = true;
  }
});
function countCells(frame: GameFrame) {
  return frame.snapshot.paint.surfaces.reduce((n, s) => n + s.cells.length, 0);
}
function sampleResources() {
  const info = view.renderer.info;
  return {
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? null,
    calls: info.render.calls,
    triangles: info.render.triangles,
  };
}
function resetScene() {
  const mapId = mapIds[resets % mapIds.length];
  sim = new Simulation({
    modeId: "qa-soak",
    mapId,
    seed: 8472 + resets,
    teamMode: true,
    initialPaint: fullInk(mapId),
  });
  for (let i = 0; i < 8; i++)
    sim.addPlayer(
      `qa-${i}`,
      `QA ${i + 1}`,
      "artist",
      ["roller"],
      "qa",
      maps[mapId].spawns[i],
    );
  lastFrame = sim.takeFrame();
  view.resetSession(lastFrame.snapshot);
  view.frame(lastFrame, "qa-0");
  resets++;
  nextResetAt = performance.now() + 900;
}
function startRun(seconds: number, onlyResets = false) {
  running = false;
  resets = 0;
  frameTimes = [];
  resetSamples = [];
  rafCount = rafTotalMs = inputSeq = totalTicks = 0;
  maxFrameMs = longFrames = 0;
  hiddenDuringRun = false;
  valid = true;
  end = 0;
  finalMetrics = null;
  duration = seconds;
  resetOnly = onlyResets;
  accumulator = 0;
  status = onlyResets ? "running" : "warming up (2 seconds)";
  resetScene();
  // Exclude synchronous scene allocation and shader warm-up from the timed run.
  view.draw(lastFrame.snapshot, "qa-0", 0, 0.98);
  start = previous = performance.now();
  running = true;
}
function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor((sorted.length - 1) * p)] * 10) / 10;
}
function metrics(now: number) {
  const elapsed = start ? ((end || now) - start) / 1000 : 0;
  const fps = rafCount ? (1000 * rafCount) / rafTotalMs : null;
  return {
    status,
    valid,
    hardware,
    targetWallSeconds: duration,
    elapsedWallSeconds: +elapsed.toFixed(1),
    simulatedSeconds: totalTicks / 60,
    totalTicks,
    currentSceneTick: lastFrame?.snapshot.tick ?? 0,
    rafAverageFps: fps ? +fps.toFixed(1) : null,
    rafFrameMsP50Rolling: percentile(frameTimes, 0.5),
    rafFrameMsP95Rolling: percentile(frameTimes, 0.95),
    rafRollingSamples: frameTimes.length,
    rafTotalSamples: rafCount,
    maxFrameMs: +maxFrameMs.toFixed(1),
    longFrames,
    hiddenDuringRun,
    renderer: sampleResources(),
    paintCells: lastFrame ? countCells(lastFrame) : 0,
    projectiles: lastFrame?.snapshot.projectiles.length ?? 0,
    resets,
    map: lastFrame?.snapshot.mapId,
    resetSamples,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    visibility: document.visibilityState,
  };
}
function loop(now: number) {
  let delta = now - previous;
  previous = now;
  if (running && status === "warming up (2 seconds)" && now-start >= 2000) {
    // Compile the equipped roller and transient effects before timed sampling.
    // The following run still lasts the full requested wall-clock duration.
    status="running";start=now;delta=0;accumulator=0;totalTicks=0;
    rafCount=rafTotalMs=maxFrameMs=longFrames=0;frameTimes=[];
    valid=true;hiddenDuringRun=false;
  }
  if (running) {
    if (delta > 0 && status === "running") {
      maxFrameMs = Math.max(maxFrameMs, delta);
      if (delta > 250) longFrames++;
      rafCount++;
      rafTotalMs += delta;
      frameTimes.push(delta);
      if (frameTimes.length > 3600) frameTimes.shift();
    }
    if (status === "running" && (document.visibilityState !== "visible" || delta > 250)) valid = false;
    if (resetOnly && resets < 10 && now >= nextResetAt) {
      resetSamples.push({
        reset: resets,
        elapsedWallSeconds: +((now - start) / 1000).toFixed(1),
        ...sampleResources(),
        paintCells: countCells(lastFrame),
      });
      resetScene();
    }
    if (!resetOnly) {
      accumulator += Math.min(delta, 250) / 1000;
      let steps = 0;
      while (accumulator >= 1 / 60 && steps++ < 5) {
        for (let i = 0; i < 8; i++) {
          const a = lastFrame.snapshot.actors.find(
            (actor) => actor.id === `qa-${i}`,
          );
          if (!a) continue;
          const angle = (totalTicks / 60) * 0.27 + (i * Math.PI) / 4;
          sim.input(a.id, {
            seq: ++inputSeq,
            moveX: Math.cos(angle),
            moveZ: Math.sin(angle),
            yaw: angle,
            pitch: 0.15,
            sprint: false,
            jump: false,
            primary: true,
            secondary: false,
            reload: false,
            skill: false,
            grapple: false,
            slot: 2,
          });
        }
        sim.step();
        totalTicks++;
        accumulator -= 1 / 60;
      }
      if (steps > 5) accumulator = Math.min(accumulator, 1 / 60);
      lastFrame = sim.takeFrame();
      view.frame(lastFrame, "qa-0");
    }
    if (
      resetOnly
        ? resets >= 10 && now >= nextResetAt
        : now - start >= duration * 1000
    ) {
      running = false;
      end = now;
      status = valid
        ? "complete"
        : "complete (invalid: hidden tab or long frame gap)";
      resetSamples.push({
        reset: resets,
        elapsedWallSeconds: +((now - start) / 1000).toFixed(1),
        ...sampleResources(),
        paintCells: countCells(lastFrame),
      });
      finalMetrics = metrics(now);
    }
  }
  view.spectator = new Vector3(
    Math.sin(now / 9000) * 11,
    38,
    22 + Math.cos(now / 9000) * 8,
  );
  view.draw(lastFrame?.snapshot ?? null, "qa-0", 0, 0.98);
  if (Math.floor(now / 500) !== Math.floor((now - delta) / 500))
    out.textContent = JSON.stringify(finalMetrics ?? metrics(now), null, 2);
  requestAnimationFrame(loop);
}
$("long").onclick = () => startRun(1800);
$("pixels").onclick = () => {
  if (!running)
    $("pixel-results").textContent = JSON.stringify(
      checkPaintPixels(),
      null,
      2,
    );
};
$("short").onclick = () => startRun(30);
$("reset").onclick = () => startRun(0, true);
$("stop").onclick = () => {
  running = false;
  end = performance.now();
  status = "stopped";
  finalMetrics = metrics(end);
  out.textContent = JSON.stringify(finalMetrics, null, 2);
};
$("download").onclick = () => {
  const blob = new Blob(
    [JSON.stringify(finalMetrics ?? metrics(performance.now()), null, 2)],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ink-qa-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
resetScene();
requestAnimationFrame(loop);
