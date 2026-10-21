import type {
  MapDefinition,
  BoxDefinition,
  PaintSurface,
  Vec3,
} from "../shared/contracts";
import { v, add, mul } from "../core/math";
function box(
  id: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  scoring = false,
  color?: number,
): BoxDefinition {
  return { id, center: v(x, y, z), size: v(w, h, d), scoring, color };
}
/** Six paint planes per box are the very same geometry used by collision. */
export function surfacesForBox(b: BoxDefinition): PaintSurface[] {
  const faces: {
    n: Vec3;
    u: Vec3;
    v: Vec3;
    w: number;
    h: number;
    offset: number;
    name: string;
  }[] = [
    {
      n: v(0, 1, 0),
      u: v(1, 0, 0),
      v: v(0, 0, -1),
      w: b.size.x,
      h: b.size.z,
      offset: b.size.y / 2,
      name: "top",
    },
    {
      n: v(0, -1, 0),
      u: v(1, 0, 0),
      v: v(0, 0, 1),
      w: b.size.x,
      h: b.size.z,
      offset: b.size.y / 2,
      name: "bottom",
    },
    {
      n: v(1, 0, 0),
      u: v(0, 0, -1),
      v: v(0, 1, 0),
      w: b.size.z,
      h: b.size.y,
      offset: b.size.x / 2,
      name: "east",
    },
    {
      n: v(-1, 0, 0),
      u: v(0, 0, 1),
      v: v(0, 1, 0),
      w: b.size.z,
      h: b.size.y,
      offset: b.size.x / 2,
      name: "west",
    },
    {
      n: v(0, 0, 1),
      u: v(1, 0, 0),
      v: v(0, 1, 0),
      w: b.size.x,
      h: b.size.y,
      offset: b.size.z / 2,
      name: "south",
    },
    {
      n: v(0, 0, -1),
      u: v(-1, 0, 0),
      v: v(0, 1, 0),
      w: b.size.x,
      h: b.size.y,
      offset: b.size.z / 2,
      name: "north",
    },
  ];
  return faces
    .filter((f) => f.name !== "bottom")
    .map((f) => ({
      id: `${b.id}:${f.name}`,
      center: add(b.center, mul(f.n, f.offset + 0.006)),
      u: f.u,
      v: f.v,
      normal: f.n,
      width: f.w,
      height: f.h,
      cellSize: 0.55,
      scoring: !!b.scoring && f.name === "top",
      boxId: b.id,
    }));
}
function build(
  id: string,
  name: string,
  chapter: number,
  description: string,
  features: BoxDefinition[],
): MapDefinition {
  const width = 48,
    depth = 56;
  const boxes = [
    box("ground", 0, -0.25, 0, width, 0.5, depth, true),
    box("north", 0, 2.4, -28, width, 4.8, 0.5),
    box("south", 0, 2.4, 28, width, 4.8, 0.5),
    box("west", -24, 2.4, 0, 0.5, 4.8, depth),
    box("east", 24, 2.4, 0, 0.5, 4.8, depth),
    ...features,
  ];
  const spawns = [
    v(-16, 0, 22),
    v(16, 0, -22),
    v(16, 0, 22),
    v(-16, 0, -22),
    v(-20, 0, 2),
    v(20, 0, -2),
    v(-5, 0, 23),
    v(5, 0, -23),
  ];
  const navigation: Vec3[] = [];
  for (let x = -20; x <= 20; x += 4)
    for (let z = -24; z <= 24; z += 4) navigation.push(v(x, 0, z));
  return {
    id,
    name,
    chapter,
    description,
    width,
    depth,
    boxes,
    surfaces: boxes.flatMap(surfacesForBox),
    spawns,
    enemySpawns: [
      v(-20, 0, -20),
      v(20, 0, -20),
      v(-20, 0, 20),
      v(20, 0, 20),
      v(0, 0, -24),
    ],
    anchors: [
      v(-14, 9, -8),
      v(14, 9, 8),
      v(0, 8, 0),
      v(-12, 9, 15),
      v(12, 9, -15),
    ],
    objectives: [
      { id: "A", name: "画心", center: v(0, 0, 0), radius: 5 },
      { id: "B", name: "西页", center: v(-15, 0, -14), radius: 4 },
      { id: "C", name: "东页", center: v(15, 0, 14), radius: 4 },
    ],
    navigation,
  };
}
function stairs(
  prefix: string,
  x: number,
  z: number,
  direction = 1,
): BoxDefinition[] {
  return Array.from({ length: 10 }, (_, i) =>
    box(
      `${prefix}-${i}`,
      x,
      (i + 1) * 0.2,
      z + i * direction * 0.65,
      3,
      (i + 1) * 0.4,
      0.66,
      true,
    ),
  );
}
const construction = build(
  "construction",
  "笔记本工地",
  0,
  "脚手架、楼梯与高空走道；在蓝色笔记间展开战斗。",
  [
    box("platform-west", -13, 3.8, -4, 9, 0.4, 12, true),
    box("platform-east", 13, 3.8, 4, 9, 0.4, 12, true),
    ...stairs("stairs-west", -13, 8, -1),
    ...stairs("stairs-east", 13, -8, 1),
    ...[-17, -9].flatMap((x) =>
      [-9, 1].map((z) => box(`pillar-${x}-${z}`, x, 1.8, z, 0.4, 3.6, 0.4)),
    ),
    ...[9, 17].flatMap((x) =>
      [-1, 9].map((z) => box(`pillar-${x}-${z}`, x, 1.8, z, 0.4, 3.6, 0.4)),
    ),
    box("bridge", 0, 3.8, -6, 18, 0.4, 2.5, true),
    box("cover-left", -6, 1, -16, 4, 2, 3),
    box("cover-right", 6, 1, 16, 4, 2, 3),
    box("crate-1", -7, 0.7, 5, 2, 1.4, 2, false, 0xe5b06a),
    box("crate-2", 7, 0.7, -5, 2, 1.4, 2, false, 0xe5b06a),
    box("wall-left", -5, 1.3, -8, 1.1, 2.6, 5),
    box("wall-right", 5, 1.3, 8, 1.1, 2.6, 5),
  ],
);
const street = build(
  "street",
  "折纸街区",
  1,
  "折叠街巷与屋顶通道；街心广场串联两侧侧翼。",
  [
    ...[-1, 1].flatMap((sign) =>
      [-16, 10].flatMap((z, i) => [
        box(`house-${sign}-${i}`, sign * 13, 2.1, z, 7, 4.2, 7, true),
        box(`awning-${sign}-${i}`, sign * 9, 2.8, z, 3, 0.3, 8, true),
      ]),
    ),
    ...stairs("roof-west", -13, -6.4, -1),
    ...stairs("roof-east", 13, 0.7, 1),
    box("fountain-north", 0, 0.7, -7, 5, 1.4, 2),
    box("fountain-south", 0, 0.7, 7, 5, 1.4, 2),
    box("arch-west", -4, 2.7, 17, 0.7, 5.4, 0.7),
    box("arch-east", 4, 2.7, 17, 0.7, 5.4, 0.7),
    box("arch-top", 0, 5.2, 17, 8, 0.4, 1),
    box("kiosk-west", -18, 0.8, 0, 3, 1.6, 3, false, 0xe8b984),
    box("kiosk-east", 18, 0.8, 0, 3, 1.6, 3, false, 0xadd4c3),
  ],
);
const fortress = build(
  "fortress",
  "画室堡垒",
  2,
  "巨大画架与环形高台；彩墨将最后一页填满。",
  [
    box("balcony-west", -16, 3.8, 0, 6, 0.4, 26, true),
    box("balcony-east", 16, 3.8, 0, 6, 0.4, 26, true),
    box("balcony-north", 0, 3.8, -16, 32, 0.4, 5, true),
    ...stairs("fort-west", -16, 19, -1),
    ...stairs("fort-east", 16, 19, -1),
    ...[-1, 1].flatMap((s) =>
      [-10, 8].map((z, i) =>
        box(`easel-${s}-${i}`, s * 7, 1.6, z, 4, 3.2, 0.7),
      ),
    ),
    box("desk-west", -7, 0.8, 18, 5, 1.6, 3),
    box("desk-east", 7, 0.8, -21, 5, 1.6, 3),
    box("inkwell-1", -1, 1.1, -12, 2.5, 2.2, 2.5, false, 0xaf9bcc),
    box("inkwell-2", 1, 1.1, 12, 2.5, 2.2, 2.5, false, 0x85c3bd),
  ],
);
export const maps: Record<string, MapDefinition> = {
  construction,
  street,
  fortress,
};
