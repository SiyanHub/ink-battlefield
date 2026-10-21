import type { Vec3 } from "../shared/contracts";
export const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3) => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3) => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: Vec3, s: number) => v(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const norm = (a: Vec3) => mul(a, 1 / (length(a) || 1));
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b));
export const clamp = (n: number, a: number, b: number) =>
  Math.min(b, Math.max(a, n));
export const aim = (yaw: number, pitch: number) =>
  v(
    -Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
export function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
