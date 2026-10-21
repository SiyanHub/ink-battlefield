import * as T from "three";
export const ink = 0x57534d;
export function shape(geometry: T.BufferGeometry, color = 0xeee9df): T.Group {
  const g = new T.Group();
  const tone=new T.Color(color);
  const gray=tone.r*.3+tone.g*.59+tone.b*.11;
  tone.lerp(new T.Color(gray,gray,gray),.8);
  g.add(
    new T.Mesh(
      geometry,
      new T.MeshLambertMaterial({color:tone}),
    ),
  );
  g.add(
    new T.LineSegments(
      new T.EdgesGeometry(geometry, 38),
      new T.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.28 }),
    ),
  );
  g.children[1].layers.set(1);
  (g.children[0] as T.Mesh).castShadow=true;
  (g.children[0] as T.Mesh).receiveShadow=true;
  return g;
}
export function box(w: number, h: number, d: number, color?: number) {
  return shape(new T.BoxGeometry(w, h, d), color);
}
export function ball(r: number, color?: number) {
  return shape(new T.IcosahedronGeometry(r, 1), color);
}
export function part(
  g: T.Group,
  o: T.Object3D,
  x: number,
  y: number,
  z: number,
) {
  o.position.set(x, y, z);
  g.add(o);
  return o;
}
export function label(text: string, size = 1.5) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#42617b";
  ctx.textAlign = "center";
  ctx.font = '54px "Patrick Hand", sans-serif';
  const measured = ctx.measureText(text).width;
  if (measured > 480)
    ctx.font = `${Math.max(22, (54 * 480) / measured)}px "Patrick Hand", sans-serif`;
  ctx.fillText(text, 256, 78);
  const m = new T.Sprite(
    new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite:false, alphaTest:.15 }),
  );
  m.layers.set(1);
  m.scale.set(size * 4, size, 1);
  return m;
}
export function dispose(o: T.Object3D) {
  o.traverse((n) => {
    const m = n as T.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      for (const a of Array.isArray(m.material) ? m.material : [m.material]) {
        const tex = (a as T.MeshBasicMaterial).map;
        tex?.dispose();
        a.dispose();
      }
    }
  });
  o.removeFromParent();
}
