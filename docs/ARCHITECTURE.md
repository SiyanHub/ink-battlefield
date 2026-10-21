# 架构与扩展

## 边界

`main.ts` 只导入字体、样式和 App。`App` 负责界面与生命周期，不负责战斗判断。`core/Simulation` 装配 Runtime、移动、武器、技能、AI、章节和模式，固定步长1/60秒。规则依赖 plain TypeScript 数据，不导入 Three/DOM。Node 服务与 LocalSession 都调用同一 Simulation。

| 目录 | 公开职责 |
|---|---|
| shared | 可序列化输入、快照、事件、档案和共享角色几何 |
| content | 职业、武器、敌人、地图、升级定义与索引 |
| core | 碰撞/移动、战斗行为、技能、染色、AI导航、遭遇和胜负 |
| session | 相同 GameSession API 的本地与远端会话；联机房间适配 |
| server | HTTP静态文件、WebSocket验证、房间成员、权威时钟与重连 |
| client | Three模型、线稿材质、墨迹纹理、声音、输入与菜单 |
| profile | 可替换 StorageLike、版本化档案、派生挑战 |

GameSession 的 submitInput 只接收动作意图；command 处理暂停、升级、换装等；subscribe 发布 GameFrame；getSnapshot 提供显示状态；dispose 结束会话。联机服务只接受已验证输入，不接受伤害、位置、分数。服务端60Hz消费有序输入，20Hz广播；客户端按独立60Hz预测，ack之后重放未确认输入，远端位置插值。页面失焦清空动作，结果不再发送输入。

同一 MapDefinition.boxes 同时供 World 碰撞和 Renderer 几何使用。surface ID是 box ID+face，每格保存 `[index,视觉RGB,ownerId]`。每个表面格数固定，重涂覆盖旧格；墙和角色不计分，遮住的底层地板排除面积计算。飞溅瞬时对象、投射体、墨迹纹理各自回收，死亡不清墨迹。快照为完整当前状态，不回放无限历史事件。

## 增加一件武器

1. 在 content/weapons.ts 的注册列表增加 WeaponDefinition：稳定 ID、所属职业、behavior、solo/PvP伤害、节奏、容量、弹道、涂染和 model。
2. 在对应 ClassDefinition.weapons 注册 ID，或使用单独的启动注册模块；只在创建会话前注册，不能交火时修改内容表。
3. 使用已有行为，或在 weaponBehaviors 登记 `(ShotContext)=>void`。行为通过 rt.emit/paintHit/applyDamage 修改权威状态；不要访问场景。
4. 在 client/weapons.ts 为新 model 添加模型；复用现有 model 不必改 Renderer.draw。声音与事件通过稳定weapon ID关联。
5. 从公开 Simulation 输入测试攻击、换弹、职业限制、覆盖和遮挡。

可执行示例 `examples/register.ts` 同时注册“示例粉笔”和“五秒试笔”模式。`tests/extensions.test.ts` 使用标准 Simulation 接口装备、开火、染色并结算，未修改主循环。示例默认不导入生产入口，避免改变正式16武器和3模式。启用示例需在客户端和服务器创建会话前调用同一 registerExamples，且在选择界面加入对应模式项；不要只改客户端内容。

## 增加模式

实现 ModeRules 的 id、duration、target、update、onDeath，通过 modeRegistry.register 注册。规则只处理比分、目标和结束，不接管武器或渲染。updateMode 统一处理计时与平分；自定义规则可设置 finished。房间的允许模式集合与选择项也需注册相同 ID，协议输入仍需验证。无需修改 Simulation.step。

## 增加地图、职业和成长

- 地图：新增 MapDefinition 并加入 maps。用 surfacesForBox 从碰撞箱生成染色面；设置导航点、至少8出生点、钩索锚点和3个目标区。台阶高差不超过0.4米，楼梯末端与平台需接触；测试地面AI可到屋顶。地图ID需进入房间配置验证和章节列表。
- 职业：扩展 ClassId 并加入 classes，配置技能behavior、武器ID和颜色；注册 skillBehaviors、外形和UI图标，档案迁移提供新职业默认进度。不要在 Simulation.step 增加“某职业”分支。
- 敌人/Boss：增加 EnemyDefinition，复用现有 behavior；全新攻击行为需扩展 core/ai.ts 的行为实现（当前 AI 行为尚未独立成注册表），章节生成表选择稳定ID。特殊攻击必须先发telegraph事件，遵循共享角色命中几何，不按网格模型判断命中。
- 升级：增加 UpgradeDefinition，配置职业、效果键、数值、叠加上限。对应规则模块消费效果键；补给自动筛选职业和叠加上限。新效果要覆盖实际适用武器，不能只改文案。

## 存档与测试

ProfileStore 隔离 localStorage，可注入 StorageLike 做行为测试。版本1记录设置、遭遇完成数、累计成绩及检查点。损坏/不支持版本先备份原始字符串，再恢复默认档案；读写失败通过 recoveryNotice 展示，不静默声称保存成功。迁移新版本时先写兼容转换，再保存新版本。

四个验收边界：公开Simulation与ModeRules；真实WebSocket；ProfileStore/LocalSession；输入/界面presenter与浏览器。测试不要修改私有运行状态。加速内容验证可以缩短波次和降低敌人生命，但必须明确它不是实际难度通关或双机性能证据。

## 2026-10-21 重构后的职责与生命周期

- `client/App` 只装配 DOM、Input 和 Renderer；`ui/GameController` 独立持有导航、会话订阅、联机大厅与异步启动代次。`views/components/hud` 为纯视图。离开或换装会退订并 dispose 会话，迟到的异步启动不能重新覆盖首页。
- `client/Renderer` 组合 `WorldView`（同源碰撞几何、染色、预警）、`ActorView`（模型和动画）、`CombatEffects`（128个循环粒子与最多24条轨迹）、`GameAudio`、`SketchPipeline`。贴图、几何体、材质和渲染目标由创建者销毁；持久表面墨迹不依赖临时粒子。
- `SketchPipeline` 用深度/法线提取轮廓、屏幕空间排线和纸张颗粒表达石墨，按色度保留彩墨。近景武器使用 `WeaponPaper`，无需额外全屏渲染目标。武器握持、缩放和动作独立于规则伤害。
- `PlayerSystem` 管理输入锁存、移动、职业技能与复活；`EnemyAttacks` 管理攻击阶段/预警；`Simulation` 组合这些职责。`session/LocalSessionDriver` 统一60Hz更新、订阅、暂停与销毁，战役/试笔分别扩展它。
- `PracticeSession` 没有 ProfileStore 依赖。使用共享 Simulation 与真实武器，只注册独立试笔模式和静态目标复生；`continue` 重置场地与补给，`loadout` 验证同职业装备再重置。重置 tick 倒退时 Renderer 清理旧 revision、预警和瞬态效果。
- `server/server` 是组合入口；`protocol` 验证边界，`connection` 管理握手/限流/背压，`rooms` 管理房间/成员/重连，`scheduler` 用60Hz权威步进与每三tick广播，`static-http` 只提供 dist，realpath 检查禁止 junction 越界读取。

现有内容、独立单机/对战数值和网络协议保留。地图内装饰线来自真实碰撞箱；远景建筑只在边界之外，不能被误用作可进入掩体。
