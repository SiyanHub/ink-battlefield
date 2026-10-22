import { classes, maps, getLoadout } from "../content";
import { neutralInput } from "../shared/contracts";
import type { RoomSettings, InputFrame, ClassId } from "../shared/contracts";

export class ProtocolError extends Error {
  constructor(message: string, readonly code?: "resume_pending") { super(message); }
}
export function fail(message: string, code?: "resume_pending"): never {
  throw new ProtocolError(message, code);
}
export type WireMessage = Record<string, unknown> & { type: string };

export function parseMessage(raw: string): WireMessage {
  const message = JSON.parse(raw);
  if (!message || typeof message !== "object" || typeof message.type !== "string")
    fail("消息格式无效");
  return message;
}
export function parseRoomSettings(raw: any, base?: RoomSettings): RoomSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    fail("房间设置无效");
  const m = {
    modeId: raw.modeId ?? base?.modeId,
    mapId: raw.mapId ?? base?.mapId,
    teamMode: raw.teamMode ?? base?.teamMode,
    maxPlayers: raw.maxPlayers ?? base?.maxPlayers,
  };
  if (
    !["deathmatch", "control", "turf"].includes(m.modeId) ||
    !Object.hasOwn(maps, m.mapId) ||
    typeof m.teamMode !== "boolean" ||
    !Number.isInteger(m.maxPlayers) ||
    m.maxPlayers < 2 ||
    m.maxPlayers > 8
  )
    fail("房间设置无效");
  if (m.modeId !== "deathmatch") m.teamMode = true;
  return m;
}
export function parseInput(raw: any): InputFrame {
  if (!raw || typeof raw !== "object") fail("输入无效");
  const allowed = Object.keys(neutralInput());
  if (Object.keys(raw).some((k) => !allowed.includes(k)))
    fail("输入含非法字段");
  if (!Number.isSafeInteger(raw.seq) || raw.seq < 0) fail("输入序号无效");
  for (const k of ["moveX", "moveZ", "yaw", "pitch"])
    if (typeof raw[k] !== "number" || !Number.isFinite(raw[k]))
      fail("输入数值无效");
  if (
    Math.abs(raw.moveX) > 1 ||
    Math.abs(raw.moveZ) > 1 ||
    Math.abs(raw.yaw) > 100000 ||
    Math.abs(raw.pitch) > 1.6
  )
    fail("输入范围无效");
  for (const k of [
    "sprint",
    "jump",
    "primary",
    "secondary",
    "reload",
    "skill",
    "grapple",
  ])
    if (typeof raw[k] !== "boolean") fail("输入开关无效");
  if (
    raw.slot !== null &&
    (!Number.isInteger(raw.slot) || raw.slot < 0 || raw.slot > 2)
  )
    fail("武器槽无效");
  return {
    seq: raw.seq,
    moveX: raw.moveX,
    moveZ: raw.moveZ,
    yaw: raw.yaw,
    pitch: raw.pitch,
    sprint: raw.sprint,
    jump: raw.jump,
    primary: raw.primary,
    secondary: raw.secondary,
    reload: raw.reload,
    skill: raw.skill,
    grapple: raw.grapple,
    slot: raw.slot,
  };
}

export function parseHello(m: WireMessage): { name: string; token?: string } {
  if (
    typeof m.name !== "string" ||
    !m.name.trim() ||
    m.name.length > 20
  )
    fail("昵称需为1–20字符");
  if (m.token !== undefined && typeof m.token !== "string") fail("重连凭证无效");
  return { name: m.name.trim(), token: m.token };
}

export function parseRespawn(raw: any) {
  const c = raw;
  if (
    !c ||
    c.type !== "respawn" ||
    Object.keys(c).some(
      (k) => !["type", "classId", "weapons"].includes(k),
    ) ||
    typeof c.classId !== "string" ||
    !Object.hasOwn(classes, c.classId) ||
    !Array.isArray(c.weapons) ||
    c.weapons.length > 3
  )
    fail("网络比赛只允许合法重生选择");
  const definition = classes[c.classId as ClassId];
  if (
    c.weapons.some(
      (w: unknown) =>
        typeof w !== "string" ||
        (!definition.weapons.includes(w) && w !== definition.melee),
    ) ||
    new Set(c.weapons).size !== c.weapons.length ||
    c.weapons.filter((w: string) => w !== definition.melee).length > 2
  )
    fail("重生装备无效");

  return {
    type: "respawn" as const,
    classId: definition.id,
    weapons: getLoadout(definition.id, c.weapons),
  };
}

export function parseChoice(m: any) {
  if (
    typeof m.classId !== "string" ||
    !Object.hasOwn(classes, m.classId) ||
    !Array.isArray(m.weapons) ||
    m.weapons.length > 3 ||
    m.weapons.some((w: unknown) => typeof w !== "string")
  )
    fail("职业或装备无效");
  const c = classes[m.classId as ClassId];
  if (
    new Set(m.weapons).size !== m.weapons.length ||
    m.weapons.some(
      (w: string) => !c.weapons.includes(w) && w !== c.melee,
    ) ||
    m.weapons.filter((w: string) => w !== c.melee).length > 2
  )
    fail("职业装备不匹配");
  if (
    m.teamId !== undefined &&
    (typeof m.teamId !== "string" ||
      !["red", "blue"].includes(m.teamId))
  )
    fail("队伍无效");

  return {
    classId: c.id,
    weapons: getLoadout(c.id, m.weapons),
    teamId: m.teamId as string | undefined,
  };
}
