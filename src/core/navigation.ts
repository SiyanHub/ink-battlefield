import type { Vec3 } from "../shared/contracts";
import type { World } from "./world";
import { v, distance, add, sub, mul } from "./math";
/** Coarse walkable graph plus exact stair-height nodes. Shared math, no scene meshes. */
export class Navigation {
  readonly points: Vec3[] = [];
  private edges: number[][] = [];
  private paths = new Map<
    string,
    { until: number; path: number[]; index: number; goal: Vec3 }
  >();
  constructor(private world: World) {
    const candidates = [...world.map.navigation];
    for (const box of world.map.boxes) {
      if (!box.scoring || box.id === "ground") continue;
      const y = box.center.y + box.size.y / 2;
      candidates.push(v(box.center.x, y, box.center.z));
      for (let x = -box.size.x / 2 + 0.6; x < box.size.x / 2; x += 2)
        for (let z = -box.size.z / 2 + 0.6; z < box.size.z / 2; z += 2)
          candidates.push(v(box.center.x + x, y, box.center.z + z));
    }
    const seen = new Set<string>();
    for (const p of candidates) {
      const key = [p.x, p.y, p.z].map((n) => n.toFixed(1)).join(",");
      if (!seen.has(key) && !world.blocked(p, 0.48, 1.8)) {
        this.points.push(p);
        seen.add(key);
      }
    }
    this.edges = this.points.map(() => []);
    for (let i = 0; i < this.points.length; i++)
      for (let j = i + 1; j < this.points.length; j++) {
        const a = this.points[i],
          b = this.points[j];
        if (
          distance(a, b) < 4.6 &&
          Math.abs(a.y - b.y) < 0.65 &&
          this.walkable(a, b)
        ) {
          this.edges[i].push(j);
          this.edges[j].push(i);
        }
      }
  }
  private walkable(a: Vec3, b: Vec3) {
    const steps = Math.ceil(distance(a, b) / 0.3);
    for (let i = 1; i < steps; i++) {
      const p = add(a, mul(sub(b, a), i / steps));
      if (this.world.blocked(p, 0.45, 1.8, true)) return false;
    }
    return true;
  }
  private nearest(p: Vec3) {
    let best = 0,
      score = Infinity;
    this.points.forEach((n, i) => {
      const d = Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 4;
      if (d < score) {
        best = i;
        score = d;
      }
    });
    return best;
  }
  next(id: string, from: Vec3, goal: Vec3, time: number): Vec3 {
    if (Math.abs(from.y - goal.y) < 0.45 && this.walkable(from, goal))
      return goal;
    let cache = this.paths.get(id);
    if (!cache || time > cache.until || distance(cache.goal, goal) > 5) {
      const start = this.nearest(from),
        end = this.nearest(goal),
        open = new Set([start]),
        cost = new Map([[start, 0]]),
        parent = new Map<number, number>();
      let found = false;
      for (let n = 0; n < 600 && open.size; n++) {
        let current = -1,
          best = Infinity;
        for (const i of open) {
          const score =
            (cost.get(i) ?? Infinity) +
            distance(this.points[i], this.points[end]);
          if (score < best) {
            best = score;
            current = i;
          }
        }
        if (current === end) {
          found = true;
          break;
        }
        open.delete(current);
        for (const next of this.edges[current] ?? []) {
          const score =
            (cost.get(current) ?? 0) +
            distance(this.points[current], this.points[next]);
          if (score < (cost.get(next) ?? Infinity)) {
            cost.set(next, score);
            parent.set(next, current);
            open.add(next);
          }
        }
      }
      const path = [end];
      if (found) {
        while (path[0] !== start && parent.has(path[0]))
          path.unshift(parent.get(path[0])!);
      } else path.splice(0, 1, start);
      cache = { until: time + 1.5, path, index: 0, goal: { ...goal } };
      this.paths.set(id, cache);
    }
    while (
      cache.index < cache.path.length - 1 &&
      distance(from, this.points[cache.path[cache.index]]) < 1.2
    )
      cache.index++;
    return this.points[cache.path[cache.index]] ?? goal;
  }
  remove(id: string) {
    this.paths.delete(id);
  }
}
