import { PaintRaster } from "./client/paint-raster";
import type { PaintSurface, PaintCell } from "./shared/contracts";

/** Compare the incremental path with a clean full draw using actual browser pixels. */
function checkBackend(willReadFrequently: boolean) {
  const surface: PaintSurface = {
    id: "pixel-check",
    boxId: "box",
    center: { x: 0, y: 0, z: 0 },
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 0, z: 1 },
    normal: { x: 0, y: 1, z: 0 },
    width: 20,
    height: 12,
    cellSize: 0.5,
    scoring: true,
  };
  const canvas = () => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 384;
    return c;
  };
  const actual = canvas(),
    reference = canvas();
  const ctx = actual.getContext("2d", { willReadFrequently })!,
    ref = reference.getContext("2d", { willReadFrequently })!;
  const raster = new PaintRaster(surface, ctx, 512, 384);
  let cells: PaintCell[] = Array.from({ length: 960 }, (_, i) => [
    i,
    i % 2 ? 0xe85b87 : 0x44bda7,
    "qa",
  ]);
  const result: object[] = [];
  function compare(name: string) {
    const snapshot = { id: surface.id, revision: result.length + 1, cells };
    raster.apply(snapshot);
    new PaintRaster(surface, ref, 512, 384).apply(snapshot);
    const a = ctx.getImageData(0, 0, 512, 384).data,
      b = ref.getImageData(0, 0, 512, 384).data;
    let differentPixels = 0,
      maxChannelError = 0,
      maxAlphaError = 0,
      maxPremultipliedError = 0;
    const examples: object[] = [];
    for (let i = 0; i < a.length; i += 4) {
      let different = false;
      for (let k = 0; k < 4; k++) {
        const d = Math.abs(a[i + k] - b[i + k]);
        maxChannelError = Math.max(maxChannelError, d);
        different ||= d > 0;
      }
      if (different) {
        differentPixels++;
        maxAlphaError = Math.max(maxAlphaError, Math.abs(a[i + 3] - b[i + 3]));
        for (let k = 0; k < 3; k++)
          maxPremultipliedError = Math.max(
            maxPremultipliedError,
            Math.abs(a[i + k] * a[i + 3] - b[i + k] * b[i + 3]) / 255,
          );
        if (examples.length < 8)
          examples.push({
            x: (i / 4) % 512,
            y: Math.floor(i / 4 / 512),
            a: [...a.slice(i, i + 4)],
            b: [...b.slice(i, i + 4)],
          });
      }
    }
    result.push({
      willReadFrequently,
      name,
      differentPixels,
      maxChannelError,
      maxAlphaError,
      maxPremultipliedError,
      examples,
      pass: differentPixels === 0,
    });
  }
  compare("initial full paint");
  cells = cells.map((c) => (c[0] % 17 === 0 ? [c[0], 0xe9b13b, "new"] : c));
  compare("overpaint across tile boundaries");
  cells = cells.filter((c) => c[0] % 13 !== 0);
  compare("remove overlapping spots");
  raster.clear();
  cells = [];
  compare("reset to clean paper");
  cells = [
    [0, 0xff0000, "red"],
    [4, 0x0000ff, "blue"],
    [959, 0x44bda7, "green"],
  ];
  compare("new match and clipped canvas edges");
  return result;
}

export function checkPaintPixels() {
  return [...checkBackend(true), ...checkBackend(false)];
}
