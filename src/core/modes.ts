import type { ActorSnapshot, ObjectiveSnapshot } from "../shared/contracts";
import type { Runtime } from "./runtime";
import { createRegistry } from "../content/registry";
import { createPracticeGuide, updatePracticeGuide, recordPracticeDeath, type PracticeGuide } from "./practice-guide";
export interface ModeState {
  scores: Record<string, number>;
  winner: string | null;
  finished: boolean;
  lastSecond: number;
  objective: ObjectiveSnapshot;
  remaining: number;
  teamMode: boolean;
  practice?: PracticeGuide;
}
export interface ModeRules {
  id: string;
  duration: number;
  untimed?: boolean;
  target: number;
  title: string;
  update(rt: Runtime, state: ModeState): void;
  onDeath(
    rt: Runtime,
    state: ModeState,
    target: ActorSnapshot,
    source: ActorSnapshot | null,
  ): void;
}
export const modeRegistry = createRegistry<ModeRules>();
const noop = () => {};
modeRegistry.register({
  id: "solo",
  duration: 0,
  target: 1,
  title: "未完成的画页",
  update: noop,
  onDeath: noop,
});
modeRegistry.register({
  id: "practice",
  duration: 0,
  untimed: true,
  target: 3,
  title: "自由试笔 · 三项练习",
  update(rt, state) {
    updatePracticeGuide(rt, state.practice!, state.objective);
  },
  onDeath(rt, state, target, source) {
    recordPracticeDeath(rt, state.practice!, target, source);
  },
});
modeRegistry.register({
  id: "deathmatch",
  duration: 360,
  target: 20,
  title: "击杀对抗",
  update(rt, s) {
    s.objective.description = s.teamMode
      ? "团队率先取得40次击败"
      : "率先取得20次击败";
    s.objective.target = s.teamMode ? 40 : 20;
    s.objective.progress = Math.max(0, ...Object.values(s.scores));
    if (s.objective.progress >= s.objective.target) s.finished = true;
  },
  onDeath(rt, s, t, a) {
    if (a && t.kind === "player" && a.teamId !== t.teamId)
      s.scores[a.teamId] = (s.scores[a.teamId] ?? 0) + 1;
  },
});
modeRegistry.register({
  id: "control",
  duration: 480,
  target: 200,
  title: "染色占点",
  update(rt, s) {
    const zone =
      rt.map.objectives[Math.floor(rt.time / 60) % rt.map.objectives.length];
    const coverage = rt.paint.coverage(zone),
      owner = Object.entries(coverage).find(([, n]) => n >= 60)?.[0];
    s.objective.zoneId = zone.id;
    s.objective.owner = owner;
    s.objective.description = `${zone.name}：涂满60%地板后得分 · ${60 - (Math.floor(rt.time) % 60)}秒后轮换`;
    s.objective.progress = Math.max(0, ...Object.values(s.scores));
    if (owner) s.scores[owner] = (s.scores[owner] ?? 0) + 1;
    if (Math.max(0, ...Object.values(s.scores)) >= 200) s.finished = true;
  },
  onDeath: noop,
});
modeRegistry.register({
  id: "turf",
  duration: 240,
  target: 100,
  title: "全图涂地",
  update(rt, s) {
    s.scores = rt.paint.coverage();
    s.objective.description = "四分钟后，地板覆盖面积较大的队伍获胜";
    s.objective.progress = Math.max(0, ...Object.values(s.scores));
  },
  onDeath: noop,
});
export function createModeState(rule: ModeRules, teamMode = false): ModeState {
  const practice = rule.id === "practice" ? createPracticeGuide() : undefined;
  return {
    ...(practice ? { practice } : {}),
    scores: {},
    winner: null,
    finished: false,
    lastSecond: -1,
    remaining: rule.duration,
    teamMode,
    objective: {
      title: rule.title,
      description: practice ? "顺序不限 · 左键击倒纸靶 0/3 · 向地面射击染色 0/1% · E 释放职业技能" : "让每一笔都留下颜色",
      progress: 0,
      target: rule.target,
      remaining: rule.duration,
    },
  };
}
export function updateMode(rt: Runtime, rule: ModeRules, state: ModeState) {
  if (rt.solo) return;
  state.remaining = Math.max(0, rule.duration - rt.time);
  state.objective.remaining = state.remaining;
  const second = Math.floor(rt.time);
  if (rule.id === "practice" || second !== state.lastSecond) {
    state.lastSecond = second;
    rule.update(rt, state);
  }
  if (!rule.untimed && state.remaining <= 0) state.finished = true;
  if (state.finished) {
    const scores = Object.entries(state.scores).sort((a, b) => b[1] - a[1]);
    state.winner =
      scores.length &&
      scores[0][1] > 0 &&
      (scores.length === 1 || Math.abs(scores[0][1] - scores[1][1]) > 0.00001)
        ? scores[0][0]
        : null;
  }
}
