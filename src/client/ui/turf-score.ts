import type { GameSnapshot } from "../../shared/contracts";
import { teamInk } from "../../shared/ink";

/** Absolute floor coverage: untouched paper remains a visible third share. */
export function renderTurfScore(snapshot: GameSnapshot, ownTeam?: string, result = false) {
  const percent = (n: number | undefined) => Number.isFinite(n) ? Math.max(0, Math.min(100, n!)) : 0;
  const blue = percent(snapshot.scores.blue), red = Math.min(100 - blue, percent(snapshot.scores.red));
  const blank = Math.max(0, 100 - blue - red), seconds = Math.max(0, Math.ceil(snapshot.remaining));
  const clock = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const gap = Math.abs(blue - red), leaderName = blue > red ? teamInk.blue.name : teamInk.red.name;
  const leader = gap <= .00001 ? "双方持平" : gap < .05 ? `${leaderName}微弱领先` : `${leaderName}领先 ${gap.toFixed(1)}%`;
  const segment = (team: "blue" | "red", amount: number) => `<span class="turf-segment ${team}" style="width:${amount.toFixed(4)}%;background:${teamInk[team].css}" role="progressbar" aria-label="${teamInk[team].name}地面覆盖率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${amount.toFixed(1)}"></span>`;
  return `<section class="turf-score ${result ? "turf-result" : ""} ${seconds <= 30 && !result ? "turf-final-seconds" : ""}" aria-label="双队涂地战况" style="--turf-blue:${teamInk.blue.css};--turf-red:${teamInk.red.css}"><div class="turf-score-top"><span>${result ? "最终覆盖" : "双队涂地"}</span><strong class="turf-clock" aria-label="剩余时间">${result ? "时间到" : clock}</strong><span>${leader}</span></div><div class="turf-numbers"><span class="blue"><i></i>${teamInk.blue.name}${ownTeam === "blue" ? '<small>你的队伍</small>' : ""}<b>${blue.toFixed(1)}%</b></span><span class="red"><b>${red.toFixed(1)}%</b>${ownTeam === "red" ? '<small>你的队伍</small>' : ""}${teamInk.red.name}<i></i></span></div><div class="turf-track">${segment("blue", blue)}<span class="turf-blank" style="width:${blank.toFixed(4)}%"></span>${segment("red", red)}</div><div class="turf-score-foot"><span>未染色 ${blank.toFixed(1)}%</span><span>${result ? "只计算可染色地板" : "倒计时结束，地面占比高的一队胜利"}</span></div></section>`;
}
