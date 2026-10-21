import type { Profile } from "../shared/contracts";
/** Challenges derive from durable counters; claiming them never changes combat stats. */
export function challenges(profile: Profile) {
  const encounters = Object.values(profile.progress).reduce((a, b) => a + b, 0);
  return [
    {
      name: "第一笔",
      description: "累计完成1场遭遇",
      current: encounters,
      target: 1,
    },
    {
      name: "熟悉画具",
      description: "同一职业累计完成6场遭遇",
      current: Math.max(...Object.values(profile.progress)),
      target: 6,
    },
    {
      name: "百笔成画",
      description: "累计击败100个敌人",
      current: profile.stats.kills,
      target: 100,
    },
    {
      name: "完整画卷",
      description: "完整通关一次三章战役",
      current: profile.stats.wins,
      target: 1,
    },
    {
      name: "四种笔触",
      description: "四职业各完成至少3场遭遇",
      current: Object.values(profile.progress).filter((n) => n >= 3).length,
      target: 4,
    },
  ];
}
