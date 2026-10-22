/** Shared identity for gameplay ink, avatars, effects and interface labels. */
export const teamInk = {
  blue: { color: 0x1977bd, css: "#1977bd", name: "蓝墨队" },
  red: { color: 0xe05b35, css: "#e05b35", name: "朱墨队" },
} as const;

export function teamInkColor(teamId: string, fallback: number): number {
  return teamId === "blue" || teamId === "red" ? teamInk[teamId].color : fallback;
}
