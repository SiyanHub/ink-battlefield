# 核心玩法、成长与本地会话独立审查

范围：`src/core/**`、`src/content/**`、`src/profile/**`、`src/session/local.ts`、共享契约及已有非联网测试；为核对几何同步追踪了客户端模型。需求依据为任务说明、CLIENT-BRIEF/NETWORK-BRIEF、契约和实际展示的武器/职业/升级说明；本次没有可单独读取的已批准完整 PRD，未凭猜测增加玩法要求。

只读应用；没有浏览器操作、没有重复运行已有成功测试。额外通过 `node --import tsx --input-type=module -` 做公开 Simulation 接口的定向复现，没有访问或修改 rt 私有运行状态。以下是修复前审查证据，主代理可能随后并行修改源码。

## 需求轴：需要修改

### P1 — 最后一波刚生成就被判定清场

- `src/core/campaign.ts:7,10-16`：alive 在本 tick 生成敌人之前计算；最后一波生成后 wave 达到 totalGroups，旧 alive 仍可能为零，于是 finish。
- 公开复现：`new Simulation({modeId:'solo',seed:1,campaign:{completed:0,upgrades:[],groups:1}})`，添加玩家后 `advance(.7)`。
- 实际结果：`phase='upgrade'`、`completed=1`、`aliveEnemies=2`。正常 12 波下只要前一波清空，最后一波同样会被跳过。
- 最小修复：生成后重新判断当前活敌集合，或本 tick 有生成就不允许结算；回归应断言出现末波时仍 playing，并实际消灭末波后才升级。防守/染色的共同清场条件也要使用新状态。

### P1 — 大型敌人模型和命中高度不同，瞄准头部无效

- `src/core/combat.ts:12,65`；跨层来源 `src/client/models.ts:9,11,75-76`。
- 例如 doodler radius=1.5，模型总缩放 `(1.5/.38)*1.4≈5.526`，可见头中心是脚底以上 `1.52*5.526≈8.4m`；核心头命中球中心却固定在 2.5m、半径 .93m，身体球在 1.5m。两者完全不相交。brute 等非 boss 也因整模缩放而出现明显错位。
- 影响：射向真实可见头/上半身的射线与投射物穿过模型，没有命中伤害；不是单纯比例或美术偏好。
- 最小修复：共享明确的角色头/身体/碰撞尺寸，模型以这些尺寸制作；或限制模型缩放并使核心的命中球/AI发射点同源。针对大敌人按可见头中心发射的命中检查应覆盖射线和投射物。

### P2 — 通用染色升级对投射武器不生效

- `src/core/combat.ts:34,68-69`；升级文案 `src/content/upgrades.ts:4`。
- hitscan/近战计算了 `1+effect('paint')`，launch 却直接保存 w.paintRadius；榴弹、弓、铅笔连射器的墨迹范围不随升级增加。
- 公开复现：同 seed 的 solo Simulation，artist+pencil 向地板单发，比较 upgrades=[] 与 ['paint','paint','paint']。两者都是 **11 cells**；3 层应提升60%半径。
- 最小修复：创建 ProjectileRuntime 时保存经过升级计算的最终 paintRadius，包含爆破/落地使用路径；新增比较基础和升级覆盖面积的公开行为检查。

### P2 — 闪步方向与玩家看到的技能说明相反

- `src/content/classes.ts:3` 宣称“沿移动方向快速突进”；`src/core/skills.ts:4` 仅设置持续时间，`src/core/simulation.ts:25` 永远取 `aim(a.yaw,0)`。
- 复现：面朝 -Z，按 S 或 A 同时 E。实际闪步仍向 -Z，而非后退或侧移方向。
- 最小修复：施放时由 moveX/moveZ/yaw 计算并存储归一化水平冲刺方向，零移动才用朝向；或经产品确认改技能说明。本审查只核对当前已展示的行为承诺。

### P2 — 武士刀说明承诺弹返，实际只有减伤

- `src/content/weapons.ts:8` 宣称“右键格挡与弹返”；`src/core/damage.ts:5` 唯一 katana secondary 行为是 `amount*=.18`；`combat.ts:64-71` 遇到角色后直接消费弹体，未改方向或归属。
- 最小修复：若保留现说明，实现有明确触发条件的反射；若该版只要求格挡，将说明明确为正面减伤。这里没有追加“完美格挡窗口”等未经批准机制。

## 代码质量轴：需要修改

### P1 — 新输入覆盖未消费的一次性动作

- `src/core/simulation.ts:13-15,29`。
- input() 用新帧替换完整 state.input；如果模拟 step 前收到一次 jump=true 后再收到 neutral，动作立即丢失。App 输入来自 RAF、本地模拟另用 60Hz interval，正常高刷新率下就是可能的真实顺序；网络批量到达也可发生。
- 公开复现：addPlayer → input(seq1,jump=true) → input(seq2,neutral) → step。实际玩家仍 `grounded=true,y=0`。
- 最小修复：持续字段取最新值，一次性 jump/reload/skill/grapple 在 tick 消费前锁存，slot 保留最后一个非 null；seq/ack 仍按实际消费帧语义处理。为各脉冲补一个“后续 neutral 不取消”的公开测试，而不是只验证 input 有被调用。

### P2 — 每次击杀都可能吞掉扩容弹匣已有子弹

- `src/core/damage.ts:12` 对击杀者总是执行 `Math.min(w.capacity,ammo.clip+effect('recycle'))`，即使没有 recycle 升级也会执行；上限是基础容量。
- 公开复现：magazine 升级的 rifle，先正常 R 装满到38发，再击杀一个敌人。实际 **38→30**，而不是38→37。本次通过内容覆盖提高单发伤害缩短复现，仍使用普通 Simulation 输入/击杀管线。
- 最小修复：只有回收量>0才回弹，且上限使用实际扩容容量。还应使 createPlayer/新遭遇初始 ammo 与扩容容量一致，避免每次换关都以基础容量开始；复用一个容量计算函数可防两个路径再次偏离。

## 已检查且未据此报缺陷

- 16 个武器定义都有注册行为；burst、pellets、charge、projectile、beam、melee、roller 有实际分支，并非只换名称颜色。上述两项武器/染色问题仍影响真实性。
- 30 项升级 effect 均有消费位置；存在消费点不能证明所有适用武器都获益，故单独验证了投射染色与弹匣交互。
- 本地同章 continue 保留 paint，跨章重建；checkpoint 存职业、seed、completed、升级与装备；死亡/胜利结算清当前 checkpoint，同时保留长期解锁。没有额外假设 checkpoint 必须保存整场弹体或所有墨迹。
- ProfileStore 有损坏备份、版本校验和装备过滤；LocalSession dispose 清 timer/listener/visibility listener。未发现这两条正常路径的无限泄漏。
- 地图使用同一 boxes 定义构建 World 与客户端，paint scoring 排除箱下遮挡地板；本轮确定的几何问题是角色命中体/视觉缩放，不是地图网格方向。
- 既有测试覆盖初始刷怪、近战 AI、部分武器、存档与暂停，但没有末波最终结算、多个输入到达同 tick、升级相互作用、大敌人可见命中位置。本文定向复现补充的是这些未覆盖行为，不是重跑旧测试。

结论：需求轴 5 项（最高 P1）；质量轴 2 项（最高 P1）。末波、动作丢失、角色命中几何应优先修复，之后关闭成长效果与内容承诺差异；无需为本次问题做大规模重构。
