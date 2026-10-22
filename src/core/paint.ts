import type {
  BoxDefinition,
  PaintCell,
  PaintSnapshot,
  PaintSurface,
  Vec3,
  CaptureZone,
} from "../shared/contracts";
import { add, mul, sub, dot, distance } from "./math";
export class PaintField {
  private readonly fields = new Map<
    string,
    {
      surface: PaintSurface;
      cells: Map<number, PaintCell>;
      revision: number;
      valid: Set<number>;
    }
  >();
  private revision = 0;
  private scoringArea = 0;
  private readonly ownerAreas = new Map<string, number>();
  constructor(surfaces: PaintSurface[], occluders: BoxDefinition[] = []) {
    for (const surface of surfaces) {
      const width = Math.ceil(surface.width / surface.cellSize),
        height = Math.ceil(surface.height / surface.cellSize),
        valid = new Set<number>();
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const point = add(
            surface.center,
            add(
              mul(surface.u, (x + 0.5) * surface.cellSize - surface.width / 2),
              mul(surface.v, (y + 0.5) * surface.cellSize - surface.height / 2),
            ),
          );
          if (
            !surface.scoring ||
            !occluders.some(
              (b) =>
                b.id !== surface.boxId &&
                Math.abs(point.x - b.center.x) < b.size.x / 2 &&
                Math.abs(point.z - b.center.z) < b.size.z / 2 &&
                point.y + 0.08 > b.center.y - b.size.y / 2 &&
                point.y + 0.08 < b.center.y + b.size.y / 2,
            )
          ) {
            valid.add(y * width + x);
            if (surface.scoring)
              this.scoringArea +=
                Math.min(surface.cellSize, surface.width - x * surface.cellSize) *
                Math.min(surface.cellSize, surface.height - y * surface.cellSize);
          }
        }
      this.fields.set(surface.id, {
        surface,
        cells: new Map(),
        revision: 0,
        valid,
      });
    }
  }
  stamp(
    id: string,
    point: Vec3,
    radius: number,
    owner: string,
    color: number,
  ): PaintCell[] {
    const f = this.fields.get(id);
    if (!f || !Number.isFinite(radius) || radius <= 0) return [];
    const s = f.surface,
      delta = sub(point, s.center),
      u = dot(delta, s.u) + s.width / 2,
      w = dot(delta, s.v) + s.height / 2,
      cols = Math.ceil(s.width / s.cellSize),
      rows = Math.ceil(s.height / s.cellSize);
    const cells: PaintCell[] = [];
    for (
      let y = Math.max(0, Math.floor((w - radius) / s.cellSize));
      y < Math.min(rows, Math.ceil((w + radius) / s.cellSize));
      y++
    )
      for (
        let x = Math.max(0, Math.floor((u - radius) / s.cellSize));
        x < Math.min(cols, Math.ceil((u + radius) / s.cellSize));
        x++
      ) {
        const dx = (x + 0.5) * s.cellSize - u,
          dy = (y + 0.5) * s.cellSize - w,
          index = y * cols + x;
        if (dx * dx + dy * dy > radius * radius || !f.valid.has(index))
          continue;
        const cell: PaintCell = [index, color & 0xffffff, owner];
        this.recordCell(s, f.cells, cell);
        cells.push(cell);
      }
    if (cells.length) {
      f.revision++;
      this.revision++;
    }
    return cells;
  }
  coverage(zone?: CaptureZone): Record<string, number> {
    if (!zone)
      return Object.fromEntries(
        [...this.ownerAreas].map(([owner, area]) => [
          owner,
          this.scoringArea ? Math.min(100, Math.max(0, area / this.scoringArea * 100)) : 0,
        ]),
      );
    let total = 0;
    const area: Record<string, number> = {};
    for (const { surface: s, cells, valid } of this.fields.values()) {
      if (!s.scoring) continue;
      const cols = Math.ceil(s.width / s.cellSize);
      for (const index of valid) {
        const x = index % cols,
          y = Math.floor(index / cols);
        const point = add(
          s.center,
          add(
            mul(s.u, (x + 0.5) * s.cellSize - s.width / 2),
            mul(s.v, (y + 0.5) * s.cellSize - s.height / 2),
          ),
        );
        if (
          zone &&
          (distance(point, zone.center) > zone.radius ||
            Math.abs(point.y - zone.center.y) > 1)
        )
          continue;
        const size =
          Math.min(s.cellSize, s.width - x * s.cellSize) *
          Math.min(s.cellSize, s.height - y * s.cellSize);
        total += size;
        const c = cells.get(index);
        if (c) area[c[2]] = (area[c[2]] ?? 0) + size;
      }
    }
    return Object.fromEntries(
      Object.entries(area).map(([team, a]) => [
        team,
        total ? (a / total) * 100 : 0,
      ]),
    );
  }
  snapshot(): PaintSnapshot {
    return {
      revision: this.revision,
      surfaces: [...this.fields.values()]
        .filter((f) => f.cells.size)
        .map((f) => ({
          id: f.surface.id,
          revision: f.revision,
          cells: [...f.cells.values()].map((c) => [...c] as PaintCell),
        })),
    };
  }
  restore(snapshot: PaintSnapshot) {
    this.ownerAreas.clear();
    for (const f of this.fields.values()) {
      f.cells.clear();
      f.revision = 0;
    }
    this.revision = snapshot.revision;
    for (const s of snapshot.surfaces) {
      const f = this.fields.get(s.id);
      if (f) {
        f.revision = s.revision;
        for (const c of s.cells)
          if (f.valid.has(c[0])) this.recordCell(f.surface, f.cells, [...c]);
      }
    }
  }
  /** A changed cell transfers only its real area; wall color never changes scores. */
  private recordCell(surface: PaintSurface, cells: Map<number, PaintCell>, cell: PaintCell) {
    const previous = cells.get(cell[0]);
    if (surface.scoring && previous?.[2] !== cell[2]) {
      const cols = Math.ceil(surface.width / surface.cellSize),
        x = cell[0] % cols,
        y = Math.floor(cell[0] / cols),
        area = Math.min(surface.cellSize, surface.width - x * surface.cellSize) *
          Math.min(surface.cellSize, surface.height - y * surface.cellSize);
      if (previous) {
        const remaining = (this.ownerAreas.get(previous[2]) ?? 0) - area;
        if (remaining > 1e-10) this.ownerAreas.set(previous[2], remaining);
        else this.ownerAreas.delete(previous[2]);
      }
      this.ownerAreas.set(cell[2], (this.ownerAreas.get(cell[2]) ?? 0) + area);
    }
    cells.set(cell[0], cell);
  }
}
