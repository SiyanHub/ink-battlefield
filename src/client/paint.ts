import * as T from "three";
import type { PaintSnapshot, PaintSurface } from "../shared/contracts";
import { PaintPresentation } from "./presenter";
import { PaintRaster } from "./paint-raster";
export class PaintView {
  presentation = new PaintPresentation();
  entries = new Map<
    string,
    {
      def: PaintSurface;
      canvas: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D;
      texture: T.CanvasTexture;
      revision: number;
      mesh: T.Mesh;
      raster: PaintRaster;
    }
  >();
  constructor(group: T.Group, surfaces: PaintSurface[]) {
    for (const s of surfaces) {
      const c = document.createElement("canvas");
      c.width = Math.min(1024, Math.max(64, Math.ceil(s.width * 28)));
      c.height = Math.min(1024, Math.max(64, Math.ceil(s.height * 28)));
      const texture = new T.CanvasTexture(c);
      texture.colorSpace = T.SRGBColorSpace;
      const mesh = new T.Mesh(
        new T.PlaneGeometry(s.width, s.height),
        new T.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.82,
          depthWrite: false,
          side: T.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      mesh.layers.set(1);
      mesh.visible=false;
      const u = new T.Vector3(s.u.x, s.u.y, s.u.z),
        v = new T.Vector3(s.v.x, s.v.y, s.v.z),
        n = new T.Vector3(s.normal.x, s.normal.y, s.normal.z);
      mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(u, v, n));
      mesh.position.set(
        s.center.x + n.x * 0.012,
        s.center.y + n.y * 0.012,
        s.center.z + n.z * 0.012,
      );
      group.add(mesh);
      const ctx = c.getContext("2d")!;
      this.entries.set(s.id, {
        def: s,
        canvas: c,
        ctx,
        texture,
        revision: -1,
        mesh,
        raster: new PaintRaster(s, ctx, c.width, c.height),
      });
    }
  }
  reset() {
    this.presentation.reset();
    for (const e of this.entries.values()) {
      e.mesh.visible=false;
      e.raster.clear();
      e.revision = -1;
      e.texture.needsUpdate = true;
    }
  }
  update(paint: PaintSnapshot) {
    for (const [id, s] of this.presentation.apply(paint)) {
      const e = this.entries.get(id);
      if (!e) continue;
      if (!s) {
        e.mesh.visible=false;
        e.raster.clear();
        e.revision = -1;
        e.texture.needsUpdate = true;
        continue;
      }
      e.revision = s.revision;
      e.mesh.visible=s.cells.length>0;
      if (e.raster.apply(s)) e.texture.needsUpdate = true;
    }
  }
}
