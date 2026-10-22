/** Small deterministic, mono foley sketches. Times are seconds, frequencies Hz. */
interface Stroke {
  kind: "noise" | "tone";
  start?: number;
  duration: number;
  from: number;
  to?: number;
  level: number;
  attack?: number;
  grain?: number;
}
export interface SoundSketch {
  duration: number;
  strokes: readonly Stroke[];
}
const noise = (duration: number, from: number, to: number, level: number, attack = .002, grain = 0): Stroke =>
  ({kind: "noise", duration, from, to, level, attack, grain});
const tone = (duration: number, from: number, to: number, level: number, start = 0): Stroke =>
  ({kind: "tone", duration, from, to, level, start, attack: .002});
const sketch = (duration: number, ...strokes: Stroke[]): SoundSketch => ({duration, strokes});

/** Keys follow WeaponDefinition.model, with explicit weapon-id lookup in GameAudio. */
export const soundPalette: Readonly<Record<string, SoundSketch>> = {
  rifle: sketch(.13, noise(.065, 3700, 1500, .8), tone(.095, 175, 90, .34)),
  smg: sketch(.085, noise(.045, 5100, 2600, .7), tone(.06, 245, 140, .22)),
  carbine: sketch(.12, noise(.05, 3200, 1700, .75), tone(.09, 215, 110, .36)),
  shotgun: sketch(.29, noise(.2, 1400, 240, .85), tone(.22, 120, 43, .58)),
  lmg: sketch(.16, noise(.09, 2100, 650, .8), tone(.13, 135, 61, .48)),
  grenade: sketch(.3, noise(.12, 760, 190, .6), tone(.25, 155, 46, .65)),
  revolver: sketch(.17, noise(.045, 4800, 1800, .85), tone(.12, 280, 105, .42), tone(.026, 1250, 800, .09, .04)),
  sniper: sketch(.28, noise(.075, 4200, 1100, .9), tone(.19, 190, 58, .48), noise(.24, 620, 220, .18)),
  bow: sketch(.31, tone(.24, 215, 172, .46), tone(.15, 432, 345, .22), noise(.07, 2200, 1100, .22)),
  pencil: sketch(.14, noise(.115, 6300, 2700, .7, .004, 73), tone(.035, 850, 430, .1)),
  brush: sketch(.19, noise(.15, 1150, 340, .7, .012, 29), tone(.085, 380, 130, .24), tone(.06, 530, 180, .14, .045)),
  pen: sketch(.38, noise(.27, 3100, 420, .6, .006), tone(.27, 880, 95, .48), tone(.34, 220, 55, .24)),
  katana: sketch(.21, noise(.18, 1200, 5200, .65, .035), tone(.12, 720, 340, .1, .035)),
  hammer: sketch(.28, noise(.22, 480, 1500, .65, .065), tone(.19, 150, 65, .22, .04)),
  compass: sketch(.14, noise(.1, 2300, 6200, .55, .02), tone(.06, 960, 610, .12, .025)),
  roller: sketch(.24, noise(.21, 650, 220, .65, .025, 42), tone(.17, 130, 65, .16)),
  dual: sketch(.14, noise(.055, 4100, 1600, .84), tone(.10, 240, 78, .48)),
  scatter: sketch(.23, noise(.12, 2400, 500, .84), tone(.17, 170, 52, .54)),
  rocket: sketch(.43, noise(.34, 650, 1500, .72, .018), tone(.23, 90, 36, .7)),
  minigun: sketch(.095, noise(.045, 3000, 900, .76), tone(.07, 190, 85, .36)),
  crossbow: sketch(.25, tone(.17, 370, 140, .45), noise(.075, 2500, 900, .48), tone(.045, 1700, 760, .15)),
  nailgun: sketch(.26, noise(.045, 5600, 1800, .8), tone(.13, 480, 75, .58), noise(.17, 1200, 280, .22)),
  bucket: sketch(.36, noise(.28, 950, 190, .74, .026, 23), tone(.20, 260, 48, .52)),
  bubble: sketch(.32, tone(.25, 420, 74, .62), noise(.18, 640, 210, .35, .02, 19)),
  hit: sketch(.13, noise(.055, 2300, 650, .63), tone(.085, 195, 57, .58), tone(.045, 1450, 1050, .21)),
  hurt: sketch(.18, noise(.10, 750, 240, .62), tone(.14, 130, 45, .48)),
  impact: sketch(.12, noise(.085, 1100, 260, .5), tone(.07, 230, 65, .25)),
  skill: sketch(.36, noise(.3, 450, 1700, .42, .04), tone(.27, 180, 430, .32), tone(.18, 360, 650, .12, .06)),
  death: sketch(.46, noise(.32, 1700, 230, .68, .008, 31), tone(.22, 140, 39, .66), tone(.19, 740, 280, .2, .035)),
};

/** Render without a live AudioContext so synthesis can be inspected independently. */
export function synthesizeSketch(sketch: SoundSketch, sampleRate: number, seed: number): Float32Array {
  const samples = new Float32Array(Math.ceil(sketch.duration * sampleRate));
  let random = seed | 0;
  for (const stroke of sketch.strokes) {
    let phase = 0, low = 0, lower = 0;
    const offset = Math.round((stroke.start ?? 0) * sampleRate);
    const length = Math.min(Math.ceil(stroke.duration * sampleRate), samples.length - offset);
    for (let i = 0; i < length; i++) {
      const time = i / sampleRate;
      const progress = i / Math.max(1, length - 1);
      const frequency = Math.min(sampleRate * .42, stroke.from * Math.pow((stroke.to ?? stroke.from) / stroke.from, progress));
      const attack = Math.min(1, time / (stroke.attack ?? .002));
      const release = Math.min(1, (length - 1 - i) / (sampleRate * .012));
      const envelope = attack * release * Math.exp(-4.5 * progress);
      let value: number;
      if (stroke.kind === "tone") {
        phase += Math.PI * 2 * frequency / sampleRate;
        value = Math.sin(phase);
      } else {
        random = (Math.imul(random, 1664525) + 1013904223) | 0;
        const white = (random >>> 0) / 2147483648 - 1;
        // Difference of two lowpasses creates a broad, smoothly swept paper/ink band.
        low += (1 - Math.exp(-Math.PI * 2 * frequency / sampleRate)) * (white - low);
        lower += (1 - Math.exp(-Math.PI * 2 * frequency * .23 / sampleRate)) * (white - lower);
        const grain = stroke.grain ? .72 + .28 * Math.sin(time * stroke.grain * Math.PI * 2) : 1;
        value = (low - lower) * 2 * grain;
      }
      samples[offset + i] += value * envelope * stroke.level;
    }
  }
  // Remove DC and reserve headroom. Endpoints remain zero after the DC correction.
  let mean = 0;
  for (const value of samples) mean += value / samples.length;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const edge = Math.min(1, i / (sampleRate * .002), (samples.length - 1 - i) / (sampleRate * .012));
    samples[i] = (samples[i] - mean) * edge;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const scale = peak > .85 ? .85 / peak : 1;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return samples;
}
