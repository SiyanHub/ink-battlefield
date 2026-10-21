# 规则与本地会话重构记录

日期：2026-10-21。范围：core、session/local.ts、session/practice.ts、tests/practice.test.ts。未改共享消息契约、内容地图、武器数值或网络协议。

## 模块职责

- `core/players.ts`：PlayerSystem 拥有玩家创建、职业有效装备、升级后生命/弹夹、输入去重与单次动作锁存、逐帧移动/技能/武器、死亡后安全出生点选择和重建。Simulation 保留原公开调用形式，负责固定 60Hz 编排与场景阶段。
- `core/enemy-attacks.ts`：EnemyAttacks 拥有预警文案与攻击周期解析，涵盖普通近战/投射物、三个 Boss 的原有三段循环、召唤和防御设备伤害。EnemyAI 保留寻路、目标选择、移动与预警调度。没有为了拆分加入新的全局可变注册表；现有攻击数值与时序保持。
- `session/local-driver.ts`：LocalSessionDriver 拥有固定步长累积、可见性暂停、连续事件编号、订阅、手动 advance 和幂等销毁。浏览器可见性事件保留在 session 层，core 不依赖 DOM。战役会话只处理检查点/升级/奖励/结算；试笔会话不依赖 ProfileStore。
- `core/practice-targets.ts`：使用原敌人定义创建静态目标，沿用真实血量、碰撞、受击/死亡/染色。死亡五秒后移除旧尸体并在原位置补充目标，数量保持有界。

## 可用试笔入口

`createPracticeSession({ classId, weapons?, autoStart? }): GameSession` 从 `src/session/practice.ts` 导出。测试可使用同文件公开 PracticeSession 的 `advance(seconds)`，与 LocalSession 的手动时钟方式一致。

- `modeId = practice`，复用 construction 地图和同一碰撞/绘制面几何；不创建 CampaignDirector，不读写档案。
- 三个纸靶：grunt、marksman、brute。AI 不运行，使用原 PVP 伤害值；目标标题显示“试笔场 · 对战伤害”。
- 无倒计时结算、无虚构分数。真实射击、弹夹、储备、换弹、投射物和染色照常运行。
- `pause` / `resume` 可用。`continue` 重建场地、纸靶、弹药与技能状态，清除旧墨迹，并保持原暂停状态。
- `loadout` 使用当前职业的全部已开放武器进行校验，并执行同样重置。跨职业武器被过滤，职业近战自动保留。
- 练习可重复重置来补给；没有把有限弹药伪装成无限弹药。若玩家跌落，沿用原五秒复活机制。
- 同地图重置会让 tick 与 paint revision 回零；渲染端需要识别模拟重建。此要求已通知主代理。

## 验证证据

已按批准的 GameSession / Simulation 公开边界做四轮 red → green：

1. 创建/暂停/装备/独立目标：先因 practice 模块不存在失败，再实现通过。
2. 开火减弹、真实命中/击杀、尸体墨迹、五秒原位恢复：先在 replacement 不存在处失败，加入目标生命周期后通过。
3. 暂停中重置场地与补给：先在重置后时间仍为 1 失败，实现 continue 后通过。
4. 换装与销毁后拒绝输入/命令：先在 shotgun 未换成 grenade 失败，实现 loadout 后通过。

最新规则定向回归：

```powershell
npx tsx --test tests/combat.test.ts tests/campaign.test.ts tests/campaign-flow.test.ts tests/content.test.ts tests/extensions.test.ts tests/local.test.ts tests/modes.test.ts tests/paint.test.ts tests/practice.test.ts tests/profile.test.ts
npm run typecheck
```

结果：39 / 39 通过，类型检查通过。包含四职业各自九场战役、原三 LAN 模式结束条件、真实投射物/爆头/技能、检查点累计击杀、装备与扩展注册回归。

中途全量 `npm test` 为 74 / 75 通过（当时 UI 代理同步开发中），唯一失败是旧 UI 测试的 App.render 手工 fixture 缺少新 state 字段；已通知 UI 代理。全量中的真实八连接、网络协议与服务器测试通过。最终整合后的全量测试以主代理最新记录为准。

## 验收边界

本分工已验证规则与会话行为，未进行人工浏览器视觉验收。场景重置后的 GPU 墨迹清理、UI 换装/暂停呈现由主/UI 代理整合验收。没有声称自动化测试等同美术满意或两台实机 LAN 验收。
