import {weapons} from "../../content/weapons";
import type {GameEvent, Vec3} from "../../shared/contracts";
import {soundPalette, synthesizeSketch} from "../audio/Palette";

interface Voice { source: AudioBufferSourceNode; gain: GainNode; local: boolean; }
/** Local, finite WebAudio foley; one source per event, at most sixteen sources. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Set<Voice>();
  private recent = new Map<string, number>();
  private disposed = false;
  constructor(private volume: () => number) {}

  unlock() {
    if (this.disposed) return;
    try {
      if (!this.context) {
        const ctx = new AudioContext();
        this.context = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.level();
        this.limiter = ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -12;
        this.limiter.knee.value = 12;
        this.limiter.ratio.value = 8;
        this.limiter.attack.value = .003;
        this.limiter.release.value = .12;
        this.master.connect(this.limiter).connect(ctx.destination);
        for (const [index, [name, sketch]] of Object.entries(soundPalette).entries()) {
          const samples = synthesizeSketch(sketch, ctx.sampleRate, index + 971);
          const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
          buffer.getChannelData(0).set(samples);
          this.buffers.set(name, buffer);
        }
      }
      if (this.context.state === "suspended") void this.context.resume().catch(() => {});
    } catch {
      // An unavailable audio device must not prevent play; a later gesture can retry.
      this.release();
    }
  }

  event(e: GameEvent, local: boolean, listener?: Vec3, received = false) {
    const ctx = this.context, master = this.master;
    if (!ctx || !master || ctx.state !== "running" || this.disposed) return;
    const level = this.level(), now = ctx.currentTime;
    master.gain.setTargetAtTime(level, now, .012);
    if (!level) return;
    let name: string;
    if (e.type === "shot") {
      // Missing weapon identity is deliberately silent; never infer equipped gear.
      if (!e.weaponId) return;
      name = weapons[e.weaponId]?.model ?? e.weaponId;
    } else if (e.type === "hit" || e.type === "skill" || e.type === "death") {
      name = e.type === "hit" && received ? "hurt" : e.type;
    } else if (e.type === "paint" && e.pos) {
      name = "impact";
    } else return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    // Coalesce rapid events from the same actor without silencing other actors.
    const key = `${e.actorId ?? "world"}:${e.type}:${name}`;
    const cooldown = e.type === "shot" ? .026 : e.type === "hit" ? .045 : e.type === "paint" ? .10 : .06;
    if (now - (this.recent.get(key) ?? -Infinity) < cooldown) return;
    this.recent.delete(key);
    this.recent.set(key, now);
    if (this.recent.size > 96) this.recent.delete(this.recent.keys().next().value!);
    // Drop excess arrivals without cutting a waveform; reserve eight slots for local events.
    const priority=local||received;
    if (this.voices.size >= 16 || (!priority && [...this.voices].filter(v => !v.local).length >= 8)) return;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer;
    const rate = 1 + ((Math.abs(e.id) % 7) - 3) * .004;
    source.playbackRate.value = rate;
    const end = now + buffer.duration / rate;
    const distance=e.pos&&listener?Math.hypot(e.pos.x-listener.x,e.pos.y-listener.y,e.pos.z-listener.z):0;
    const attenuation=priority?1:Math.max(0,1-distance/45)**2;
    const amplitude=(priority?.31:.105)*attenuation*(e.type==="paint"?.32:e.type==="death"?1.2:1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amplitude, now + .002);
    gain.gain.setValueAtTime(amplitude, Math.max(now + .002, end - .012));
    gain.gain.linearRampToValueAtTime(0, end);
    source.connect(gain).connect(master);
    const voice = {source, gain, local:priority};
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); this.voices.delete(voice);
    };
    source.start(now);
    source.stop(end);
  }

  private level() {
    const value = this.volume();
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }

  private release() {
    const ctx = this.context;
    for (const {source, gain} of this.voices) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect(); gain.disconnect();
    }
    this.voices.clear(); this.buffers.clear(); this.recent.clear();
    this.master?.disconnect(); this.limiter?.disconnect();
    this.context = null; this.master = null; this.limiter = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const ctx = this.context;
    if (ctx?.state === "running" && this.master) {
      const gain = this.master.gain;
      gain.cancelScheduledValues(ctx.currentTime);
      gain.setValueAtTime(gain.value, ctx.currentTime);
      gain.linearRampToValueAtTime(0, ctx.currentTime + .012);
      setTimeout(() => this.release(), 24);
    } else this.release();
  }
}
