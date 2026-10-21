# 客户端交付报告

状态：DONE（等待与主代理模块集成及真实浏览器验收）。

## 交付范围

仅修改 `src/client/**`、`src/main.ts`、`index.html`、`tests/ui.test.ts`、本报告；没有修改旧 Demo、共享契约或服务端，没有提交。

- Three.js 实时主菜单场景；温暖纸面、球珠笔蓝线、手写英文；真实地图 box 几何、锚点、据点、云朵太阳与场景文字。
- 复用旧 Demo 的 `DoodleMaterial.ts` 和 `palette.ts`（原始来源 `../手绘风射击游戏/src/render/`），保留其完整着色器。其他模块为新客户端实现。
- 按 PaintSurface u/v/normal 创建纹理平面；持久 cells 按 revision 更新独立 CanvasTexture，不规则墨迹边缘、散点与透明叠色。
- 四职业不同造型、步行摆臂与腿、九敌人形态、飞行翅膀、敌人生命条、远程角色手持武器。16 个武器均按真实 model ID 构建独立轮廓（弓弦、圆规双刃、滚筒、长狙击枪、双管霰弹等）。
- 第一人称武器后坐力、近战摆动、蓄力颤动、换弹下压、狙击右键缩放、事件轨迹、弹体、基础 WebAudio 合成音效；事件 ID 去重。
- WASD / Shift / Space / 左右键 / 1–3 / 滚轮 / R / E / Q / Esc / Tab。一次性指令消费、seq 单调、真实点击请求 Pointer Lock，失败可按住拖动瞄准并提示。
- 主菜单、四职卡片、单机武器锁、继续存档、设置、联网地址昵称和开房加入、模式地图队伍准备开局、HUD、升级补给、暂停、联网死亡换职、结算查看战场/再来一局/退出。
- 输入 pitch 为负向上，镜头使用 `rotation.x=-pitch`；yaw 前向 `(-sin(yaw),0,-cos(yaw))`，W 输入 moveZ 为正，与主代理已确认。

## TDD 证据

已读取并使用 `C:/Users/ASUS/.codex/skills/tdd/SKILL.md` 及 tests/mocking 参考；UI presenter seam 由主代理传递的用户授权确认。

1. `menuTransition` 测试先执行：RED，模块不存在（ERR_MODULE_NOT_FOUND）。实现后 GREEN。验证打开联网菜单不发 pause、单机打开/关闭发 pause/resume。
2. `overlayFor` 测试先执行：RED，公开 export 不存在。实现并将真实 App 菜单渲染接入该函数后 GREEN。验证在线死亡换装、结果优先、升级状态。
3. 最新 `npx tsx --test tests/ui.test.ts`：2 passed / 0 failed。

## 集成检查边界

`npx tsc --noEmit` 当前仅报告尚未创建的 profile/store、session/local、session/network 模块和由此导致的回调类型缺失，以及主代理正在创建的 core/paint。没有 renderer/input/paint/models/weapons 的类型错误。

尚未运行真实浏览器、实际对局或网络验收；由主代理执行。请特别检查升级 command 后 phase/choices 的推进、NetworkLobby 的 rematch 会话生命周期、Pointer Lock 与局域网双客户端流程。视觉质量、敌人行为、武器伤害与持久涂色均须通过真实运行验收，不能把 UI 测试视为这些功能已验收。

## 独立审查修复（五项）

- P1 会话复位：App 在订阅前调用 Renderer.resetSession，清理事件去重、角色、特效、弹体、墨迹 revision，并立即应用完整当前 snapshot。相同 session 对象不会被 dispose。PaintPresentation 将完整快照中遗漏的表面解释为清空；重连时完整当前快照重新绘制，从而不会误丢同局墨迹。
- 战后观察：启用独立 spectator 位置与鼠标朝向，WASD 移动、Space/Ctrl 升降、Shift 加速。观察过程中不向 session 提交作战输入。菜单仅观察工具条接收指针；返回结算恢复原朝向。
- 队伍：TeamSelection 保存当前选择，渲染 select 明确 selected，ready 读取状态；成员更新不覆盖已初始化或已选择队伍。
- 失焦：clear 同时清 drag、slot、持续开火和 Tab 状态；pointerlockchange 丢锁时也清理。
- 弹体：按 ID 持续复用渲染对象，仅更新位置；消失对象进入上限 64 的外观匹配复用池，超限释放。地图/会话切换清理活动对象与闲置池。
- app/renderer/input/paint/presenter/models/weapons 已进行 TypeScript AST 格式化，便于维护；没有大规模架构改造。

回归：`npx tsx --test tests/ui.test.ts` 6 passed / 0 failed。新增新局 revision 重用/遗漏清空/重连恢复、队伍保存、观察移动与真实输入事件失焦清理。PaintPresentation 与 TeamSelection/spectator API 添加前执行测试均因缺少 export 失败，再实现后通过。输入清理用外部浏览器 EventTarget 边界替身验证公开输入结果。

最新全项目 typecheck 仍被未创建的 session/profile 模块阻塞；除此之外没有新增渲染类型错误。浏览器视觉/控制与真实联机仍交由主代理验收。

## 集成补充：成员身份、空槽位与威胁提示

- 联网房间用 NetworkLobby.playerId 精确识别自身，不再按昵称匹配。
- 单机配装始终保持 `[主武器, 第二主武器或空字符串, 近战]` 三槽位；第二槽明确显示空槽和未解锁画具。滚轮按实际装备槽跳过空槽，数字键选择空槽不发送切换指令。
- 联网死亡页面显式拼装职业卡片与装备选择器，可选择该职业全部 PvP 画具（原 classCards 已隐含装备，此次拆出避免歧义与重复）。
- 新增 ThreatView：Boss 横扫/震地/俯冲绘制与核心一致的 6/8/3.2 米攻击区域，冲锋绘制 5 米宽、约 9.35 米长的前进危险带；其他远程预警绘制瞄准虚线。中文预警标签持续到权威 telegraphUntil，死亡或到期立即移除。
- 侦察标记按 markedUntil 显示穿墙可见的中文标签和金色标记圈，到期清除。
- 测试：空槽位循环测试先因缺少 export 失败，再实现；公开 Input 事件测试增加滚轮跳槽与数字键空槽忽略。`npx tsx --test tests/ui.test.ts` 7/7；`npx tsc --noEmit` 通过。没有启动或操作浏览器。

## 模型与命中几何对齐补充

- models.ts 使用共享 actorGeometry 的水平/高度比例；Boss 额外 1.4 放大已移除。头部中心随共享 headHeight 对齐，头部纵向补偿保持与共享球形命中半径一致；玩家头半径改为 0.26。
- 身体/四肢染色只修改现有 DoodleMaterial 的颜色 uniform，不重建几何；tint=0 作为未染色恢复原纸面/职业色。固定队伍色胸标、脚底圈与头顶身份标签不被墨迹覆盖，红/蓝队同职业仍可区分；普通敌人带敌军标签。
- 三维角色技能持续表现：重装透明线框护盾，突击身后冲刺线，侦察扩散扫描圈，画师四色扩散圈，严格按 skillUntil 显隐。
- CSS：toast 在 visible 前 visibility:hidden/opacity:0，修复空蓝条；760/620 高度断点压缩首页标题、空白与按钮，适配 720px 高度。
- 测试证据：模型公开构建函数修改前 boss scale.y 为 5.526，断言期望 1.9 失败；修改后模型脚本断言通过，包括 scale、头中心 2.888、tint 颜色更新且 geometry 对象不变、技能到期隐藏。`npx tsc --noEmit` 通过。没有操作浏览器。
