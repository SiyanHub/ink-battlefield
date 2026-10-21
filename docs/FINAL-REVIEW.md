# 最终范围与可玩性独立审查

范围：当前 `docs/PRD.md`、历史 CORE-REVIEW / NETWORK-REVIEW、内容表、核心模拟/AI/地图/存档/本地会话及客户端消费链。只读应用与测试；未重复执行已通过的全套测试或浏览器流程。通过公开 Simulation API 补充两组窄范围复现。

本文是修复前审查快照；主代理可能随后修改代码。每项关闭需核对后续修改与回归证据。

## 内容接入核对

- 三章对应 construction / street / fortress，LocalSession 按 floor(completed/3) 切换地图；CampaignDirector 每章两次普通遭遇加一次 Boss，completed 达 9 进入胜利。第二遭遇由种子选择 paint / defend，并非所有单局都会包含每一种普通目标。
- 六种普通敌人进入分波序列；三 Boss 对应冲击、俯冲弹幕、召唤，均有预警与半血行为参数变化。存在行为代码不能代替整局平衡实玩。
- 16 武器进入职业装备表，12 主武器 + 4 近战，存在 hitscan / burst / pellets / projectile / charge / spray / beam / melee / roller 分支和不同节奏参数。
- 30 升级确为 18 通用 + 12 职业项，筛选进入三选一，效果键在战斗/移动/技能中有消费。不能据此声称所有组合已测；此前弹匣初始容量仍从基础容量创建，需要手动重装才能补满扩容后的空位，此项非阻断。
- deathmatch / control / turf 均进入 UI、服务端合法配置和规则更新，默认时长、目标与 60 秒轮换值与 PRD 一致。
- 公开 Registry、Simulation 内容覆盖、行为表和 ModeRules 提供扩展接点；新增武器要同时在职业可用装备表注册才能通过 getLoadout。扩展示例与用户界面完整接入证据由主代理另行验收。

## 需求与可玩性：4 项 P2 待处理

### 1. 实体弹仍穿过重装敌人的可见头部

`src/core/combat.ts` 的 updateProjectiles 只检测 actorGeometry.bodyHeight/bodyRadius，未检测共享 headHeight/headRadius。历史 CORE-REVIEW 的模型尺寸修复让射线可命中，但投射分支没有完整关闭。

公开复现：只保留地板的地图；deathmatch 模式避免 AI 移动；玩家位于 (0,0,8)，brute 位于 (0,0,0)，武器仅将 spread 覆盖为 0。以 `-atan2(actorGeometry(brute).headHeight-1.62,8)` 瞄准后射击一次，再前进 .3 秒。

- shared headHeight = 2.888；pencil：敌人仍 280 HP，弹体继续存在。
- 同位置 sniper：敌人变为 160 HP。

修复：实体弹比较身体和头球的最近交点；是否加弱点倍率属于已有平衡策略，至少不能让头部完全无碰撞。补 brute 的 pencil 公开行为回归，现有 doodler + sniper 测试不足以覆盖它。

### 2. 折纸街区楼梯与屋顶断开，地面近战 AI 无法上楼

`src/content/maps.ts`：roof-west 最后阶梯中心 z=-10.85，最外沿 -11.18；目标 house 的近边是 -12.5，存在约 1.32 米空隙。东侧路径同类缺口。`Navigation.walkable` 不验证脚下连续支撑，AI 也不会跳跃，路径跨空隙后跌落并卡在房屋下。

公开复现：solo street，玩家在西屋顶 (-13,4.2,-16)，grunt 从 (-13,0,2) 出发；只覆盖 grunt.damage=0，避免影响观察。前进 40 秒，敌人停在 (-13.698,0,-11.661)。同类 construction 和 fortress 检查均到达 y=4 的玩家平台。

修复：为 street 两处楼梯补连续落脚平台/调整阶梯，保留共享地图几何；补 ground→roof 的真实 AI 到达回归，无需此次全面重写导航。

### 3. 联网结果没有明确平局，落败客户端也显示胜利标题

`src/client/app.ts` 结果区对所有 `phase==='victory'` 显示“这一页，属于你。”；联网核心结束统一 phase= victory，而 winner=null 被显示为“比赛结束”。这不满足 PRD“平局明确显示”，也没有从当前玩家 teamId 判断输赢。击杀之外的模式没有在结果区展示最终地板比例/队伍积分。

修复：联网结果根据 winner 与当前玩家 teamId 显示获胜/落败/平局，并输出 snapshot.scores 的可读队伍/玩家名称及最终比分；单机保留其胜负逻辑。此项为源代码明确消费缺口，未操作浏览器。

### 4. 守护目标血量决定失败，但玩家界面不显示它

`CampaignDirector.defense.damage` 将 objective.deviceHp 从 500 扣到 0 即失败；`app.updateHud` 只展示通用波数/进度，没有消费 deviceHp，Renderer 的目标环也不显示剩余生命。玩家无法判断何时必须回防。

修复：当 deviceHp 有值时在任务 HUD 显示画心生命/生命条；不需要新美术或改变玩法。此项为源代码消费链确认，未操作浏览器。

## 历史与验证边界

已静态核对历史末波清场、新输入脉冲锁存、投射染色升级、弹匣击杀截断、闪步方向及武士刀描述修复。联网失焦问题由独立网络代理处理；本轮没有覆盖其并行修改。

未新增 P1；不代表全部产品验收完成。9 遭遇整局通关、20–30 分钟节奏、全部职业配装与升级交互、真实双机 LAN、1080p 实机帧率和 30 分钟持续染色/重开资源测量仍应由 ACCEPTANCE 记录真实证据，不能将内容数量或本机协议连接替代这些结论。
