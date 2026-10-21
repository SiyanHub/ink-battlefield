# 客户端独立审查

## 修复复审结论

**需求轴：通过本轮静态复审；代码质量轴：通过本轮静态复审。** 原五项问题均已关闭，没有在修复路径中发现新的阻塞问题。此结论不等同于真实浏览器或联网产品验收。下方“初次审查”保留历史证据，其行号指向格式化前的版本。

复审读取更新的完整包及实际源码；未重跑主代理确认已通过的 6/6 UI 测试，也未启动浏览器。

| 原问题 | 实际修复链及复审结果 |
| --- | --- |
| 同图新局旧涂色 | `app.ts:99-111` 在订阅前调用 `resetSession(snapshot)`；`renderer.ts:50-64` 重置旧画布/revision 并立即应用当前完整 snapshot；`paint.ts:55-70` 真正清空 canvas、标记纹理上传，`presenter.ts:29-41` 处理遗漏表面。相同 revision 在新会话可重新应用，同局完整重连快照保留已有墨迹。关闭。 |
| 战场观察控制 | `app.ts:252-258,325-331,471-491` 建立独立 spectator 位置、允许观察输入，并在观察分支完全跳过 submitInput；`renderer.ts:327-332` 在正常玩家相机计算之后覆盖观察位置与朝向，隐藏武器并复位 FOV；`style.css:2` 允许画布指针事件。关闭。 |
| 队伍被刷新覆盖 | `app.ts:227-229,277,373` 统一使用 TeamSelection 保存并呈现队伍，`presenter.ts:45-57` 的一次初始化不再覆盖主动选择。关闭；自身成员身份将依既定集成约定改用 NetworkLobby.playerId，不将临时昵称回退视作此次修复的完成接口。 |
| 失焦拖动残留 | `input.ts:36-39,82-88` 在 blur 与丢失 Pointer Lock 时清 keys/pulses、持续开火、drag、slot 和 scoreboard；不再残留无按键拖动。关闭。 |
| 弹体每帧重建 | `renderer.ts:298-325` 按 ID 保留对象、逐帧更新位置；移除后进入有 64 上限的匹配池，超限释放，地图/会话切换同时清理活动对象及池。关闭。 |

### 观察方向与退出门控专项检查

- 相机采用 `Euler(-pitch, yaw, 0, 'YXZ')`。`spectatorPosition()` 的水平前向为 `(-sin(yaw), 0, -cos(yaw))`，右向为 `(cos(yaw), 0, -sin(yaw))`，与实际相机水平基底一致。例如 yaw=0 时 W 向 -Z、D 向 +X；yaw=π/2 时 W 向 -X、D 向 -Z。水平移动加 Space/Ctrl 升降是当前明确的控制方式。
- 鼠标向右使 yaw 减小，视线向右；鼠标向上使 pitch 减小，经相机的 -pitch 后向上。没有发现观察相机的符号反转。
- 返回结算和 Esc 都经过 `stopInspect()` 清观察位置及输入、恢复入场前 yaw/pitch；render 再按结算 phase 禁用操作。观察期间没有发射、技能或移动命令流入 session。
- 已格式化主要 TypeScript 模块，原维护性建议剩余的职责集中属于非阻塞改进，不要求为本次交付重构。

仍须主代理实际验收浏览器 Pointer Lock/Esc 分发、连续同图重赛墨迹以及双客户端队伍状态；本轮仅核实实现链和报告的测试覆盖边界。

## 初次审查（历史记录，以下问题已在复审关闭）

审查依据：`docs/CLIENT-BRIEF.md`、共享契约、`artifacts/client-review.txt` 及对应源码。新项目没有 Git 基线，按全部新增客户端文件审查。只读检查，没有修改应用、启动浏览器或重复运行已经通过的测试。session/profile/core 正在集成，以下不把其未完成状态算作客户端缺陷。

## 需求符合性：需要修改

### P1 — 同地图新对局继承旧涂色

- 位置：`src/client/renderer.ts:12`、`src/client/paint.ts:6`、`src/client/app.ts:17`。
- `loadMap()` 仅按 mapId 判断是否重建；`start()` 没有重置 PaintView。PaintView 只更新快照中出现的 surface，而 `src/core/paint.ts:35` 的完整快照省略没有墨迹的 surface。
- 复现路径：在第一张地图涂色 → 退出 → 重新开始第一张地图，或同图联网重赛。新快照为空时旧画布仍显示；新局某面的 revision 恰与旧局相同还会跳过不同内容。视觉占领情况与真实状态不符。
- 最小修改：给 Renderer 明确的 session reset，重新建立或清空所有画布及 revision，并在应用完整 PaintSnapshot 时清空不再存在的 surface。事件去重状态也在订阅新会话前重置。

### P2 — “查看战场”没有可用的观察控制

- 位置：`src/client/app.ts:25,31`、`src/client/renderer.ts:24`、`src/client/style.css:1`。
- 结算阶段 input.enabled 始终 false，镜头始终绑定玩家位置和旧 yaw/pitch；inspect 的全屏 active 菜单还会截获画布鼠标事件。按下“保留并查看战场”只能移除结算框，不能转身查看最后的墨迹或其他区域。
- 最小修改：独立的本地观察镜头控制，不再提交作战输入；inspect 容器仅按钮接收指针，画布可接收拖动/观察输入。进入时保留当前场景，退出结算恢复相机状态。

### P2 — 房间刷新会悄悄把红队选择恢复为蓝队

- 位置：`src/client/app.ts:20,21,22,29`。
- team select 总是生成没有 selected 状态的 blue/red 两项；change 不保存队伍字段。选择红队后，点击职业卡或收到其他成员准备触发 render，会变回蓝队；ready 再从 DOM 读取，将玩家送到错误队伍。
- 最小修改：把本地 teamId 保存为 App 状态，change 更新；进入房间时从本人成员初始化，render 使用该状态，ready 直接提交状态而非读取新建 DOM。

## 代码质量：需要修改

### P2 — 失焦清理没有清除拖动状态

- 位置：`src/client/input.ts:7,11,14`。
- fallback 拖动瞄准中失焦，若 mouseup 发生在浏览器外，clear() 保留 drag=true；回到窗口后不按键也会持续转动视角。clear() 同样不清 slot，也未关闭 Tab 计分板。
- 最小修改：clear() 同时清除 drag、slot 并调用 scoreboard(false)。Pointer Lock 丢失时也应清理持续鼠标输入；真实 Esc 解锁行为留给浏览器验收，不能仅凭 keydown 假定全部浏览器都会弹菜单。

### P2 — 每帧重建每个弹体的几何和材质

- 位置：`src/client/renderer.ts:25`、`src/client/primitives.ts:4,6`。
- 每次 draw 都为所有仍存活弹体新建 IcosahedronGeometry、EdgesGeometry、DoodleMaterial、线材质，并在 25ms 后销毁。60fps 下每弹体每秒产生约 60 组资源，而且旧的同一弹体仍短暂共存。资源最终释放，不能称为无限泄漏，但密集弹体时有明显的分配/上传/回收负担。
- 最小修改：按 projectile.id 缓存对象并更新位置，仅在新增/移除时分配/释放；相同外观可共享几何与材质，但需明确共享资源所有权。

### 维护性建议（非阻塞、判断项）

`src/client/app.ts:21,25-39` 的动作路由、会话状态和所有页面模板集中在极长单行方法，属于可能的 Divergent Change；Renderer 同时承担地图、角色、武器、音频和特效。至少格式化并把菜单视图、会话切换和场景复位提为清晰函数，便于针对实际行为补回归检查。不要为此次审查做大规模架构重写。

## 已确认与验收边界

- 持久涂色采用独立 CanvasTexture、u/v/normal 平面、正确的 cell 行列与纵轴映射，边缘为扰动轮廓和散点；没有退化为直接绘制硬方格。
- 地图更换会遍历释放几何、材质、贴图并移除 world；角色消失和武器更换也有清理。未发现这几条路径本身的无限资源泄漏。
- 16 个武器 model 分支有不同几何结构；职业和敌人有形体分支，角色基点按脚底使用。视觉辨识度仍需浏览器验收。
- session 输入通过 submitInput/command，seq 单调，瞬时命令消费；联网暂停 presenter 不发送 pause，主入口只装配。
- 现有两项 presenter 测试仅验证菜单命令和 overlay 优先级，不证明房间状态、实际输入、paint session lifecycle 或 WebGL 行为通过。
- NetworkLobby.rematch/onSession 是否复用 GameSession 尚需集成确认：App.start 无条件 dispose 旧 session，适配器应给新对象，或 App 对相同对象短路。这里未认定实现缺陷，因为该适配器尚未交付。

结论：需求轴 3 项（最高 P1）；质量轴 2 项（最高 P2）及 1 条非阻塞维护性建议。客户端具备主要功能骨架，但同图场景状态、战场观察和队伍选择修复前不建议判为完成验收。
