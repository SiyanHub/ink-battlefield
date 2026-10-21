# 网络模块交付报告

## 实现范围

- `src/server/server.ts`：Node HTTP 与 `/ws` 同端口服务器；默认仅监听 127.0.0.1:8903，LAN 入口监听 0.0.0.0。HTTP 只解析 dist 内文件，拒绝点路径、反斜杠、源码和环境文件；GET/HEAD、内容类型和 assets 缓存。
- `src/server/entry.ts`：显示本机及全部可用 IPv4 局域网链接；正常退出关闭服务器；不修改防火墙。
- `src/session/network.ts`：原生浏览器 WebSocket，NetworkLobby、GameSession 适配、自动重连、完整墨迹恢复、事件去重、移动预测与远端插值。
- `scripts/launch.ps1`、两个中文启动脚本：检测 Node.js 22+；缺少依赖时 npm ci；启动前构建，失败立即停止；LAN 提示专用网络和 Node 防火墙排障。
- 初版没有修改 shared、core、client 或原 demo；审查修复阶段经主代理授权仅补充 client/app.ts 的回大厅消费逻辑；没有提交或部署。

## 协议与生命周期

连接先发送 `hello {name, token?}`，返回 `welcome {playerId, token}`。服务端生成 UUID 身份和 256-bit 随机 opaque token，昵称可重复且限制 1–20 字符。房间码为随机六位十六进制，碰撞重新生成。

房间请求为 create、join、configure、choose、ready、start、rematch、leave。公开状态为 room；start 包含 matchId、完整 frame、已处理 ack；普通 frame 为 20Hz，不重复发送完整 paint，而带 paint events。开始必须有 2–8 人且全部在线准备，队伍模式必须红蓝两方；主持人独占设置、开始、重赛。重赛清准备状态并等待下一次开局，每次生成新 matchId。

每房间独立 Simulation。全局调度器按真实累计时间推进固定 1/60 秒步长，每三步广播；单次落后追赶限制 0.25 秒以避免无限追赶。服务端游戏规则全部调用 Simulation，没有复制伤害、命中或胜负逻辑。

临时断线保留 30 秒，发送中性输入停止持续开火；同 token 恢复身份、原角色和完整墨迹。显式离房立即移除；断线到期移除；移除主持人时优先转交在线成员；最后成员离开删除房间。关闭服务端或断线会向客户端显示实际连接错误，重连窗口结束后明确显示失败。旧 session dispose 仅释放自身订阅/动画，不关房间 socket。

## 输入及资源约束

输入逐字段构造，拒绝未知字段（含 damage）、非法布尔、非有限数字、越界移动/视角/槽位、非法序号；重复或过期序号忽略。职业和装备白名单校验；只接受网络允许的 respawn 命令且通过同职业装备校验。16 KiB 入站包上限、每秒 150 消息上限；出站积压超过 1 MiB 关闭慢连接。未 hello 的连接 5 秒关闭。错误只影响对应请求或连接。

## 客户端表现

本地以独立固定 60Hz 调度器复用 core World/movePlayer 计算移动，收到服务端实际处理 ack 后重放最多 128 个未确认输入。高速技能/钩索速度阶段不运行普通移动预测，以权威位置为准。预测仅覆盖移动；伤害、命中、武器与技能结果仍等待权威事件。远端 actor 以 50ms 窗口插值，瞬移不跨大距离平滑。

paint 字段缺省代表增量包，不代表清空；客户端合并固定格网并始终向 UI 提供完整 paint。事件按每场递增 ID 去重。重连同一 matchId 只恢复已有 session，新比赛才触发新的 onSession。

## TDD 与验证证据

已批准 seam：真实 WebSocket 公开协议；客户端公开 GameSession 通过真实服务器联调。没有直接断言服务器私有函数，没有模拟 WebSocket 或 Simulation。

命令均为 `npx tsx --test tests/network.test.ts`：

1. 首个双连接建房/准备/开局测试先 RED：服务器文件缺失，1 fail；实现最小服务器后 GREEN：1 pass。
2. 满员、主持人权限、非法职业切片先 RED：等待拒绝消息超时；添加房间状态校验后通过。接入实际 ack 时，主代理接口尚未写入曾出现 TypeError；接口落地后完整 5/5 通过。
3. 重赛切片先 RED：公开服务器测试选项尚不支持 near-end Simulation，等待 finished 超时；加入 createSimulation factory 后 6/6 通过。此 factory 只用于本地测试 setup，以真实 Simulation.advance(359.9) 设置接近结束的比赛，没有伪造 finished 或访问 rt。
4. 后续验证扩展覆盖移动预测/旧 session 释放、过期凭证/主持权、超大包/限速，共 9/9 通过。

最终九项：

- 两个真实连接、重复昵称但独立身份、准备后开局。
- 八位可入房，第九位拒绝，非主持人开始和非法职业被拒绝。
- token 恢复身份与房间、显式退出后主持权移交。
- 伪造伤害/错误输入类型拒绝、实际 seq ack、重复 seq 忽略、普通包省略 paint、真实射击产生非空墨迹并在重连完整恢复。
- HTTP 源码、环境文件和遍历拒绝。
- 比赛结束、重赛回未准备大厅、重新准备后新 matchId。
- 客户端输入在下个固定模拟步产生预测位移，session.dispose 后 lobby 仍能收到服务器响应。
- 过期 token 无法恢复，在线成员接管主持权。
- 17KB 包关闭码 1009，超过消息速率关闭码 1008。

`npx tsc --noEmit` 本轮网络文件无类型错误；检查时项目整体仍有主代理尚未落地的 session/local 和 campaign 测试等待的 SimulationOptions.campaign/addEnemy 接口，最终全项目构建由主代理执行。

## 验收边界

测试在本机 127.0.0.1 随机端口完成，是真实协议/真实 Simulation 验证，不是八台电脑或八名真人的网络实测。30 秒保留测试使用服务端公开配置缩短等待。客户端测试为 Node 原生 WebSocket，动画回调用定时器适配；真实浏览器渲染、LAN 防火墙和另一台设备连入仍由最终集成验收确认。没有宣称生产部署、TLS、公网账号或跨公网 NAT 穿透。



## 2026-09-26 独立审查修复（替代初版时钟/生命周期描述）

`docs/NETWORK-REVIEW.md` 的五项发现已逐项修复，修复采用真实 WebSocket 公开协议 RED→GREEN：

1. 重复 token 的 hello 先查局部 candidate 并验证，成功后才绑定闭包 member。回归 RED 为拒绝后 leave 意外成功，修复后 leave 被作为未认证请求拒绝，原主持人仍能 configure。
2. NetworkLobby 增加可选 NetworkClock 调度器注入用于可重复协议测试，生产使用 performance.now/setInterval。submitInput 只更新状态并锁存 jump/reload/skill/grapple/slot；独立累计器每 1/60 秒发送并预测一次。240 次采样的 RED 为 240 包，GREEN 为 60 包；额外测试 30/60/120/240Hz 一秒位移完全一致。服务器改用最多 128 个输入步的队列，每 Simulation.step 前消费一个，ack 仍为实际处理序号。短按跳跃后立即释放的真实服务器测试先 RED（跳跃丢失），后 GREEN（跳起）。服务端 150/s 限额保持。
3. getSnapshot 为 Renderer.draw 提供插值显示副本；预测基线与显示状态分离，输入预测不使用插值位置。RED 为 25ms 时远端直接从 x16 到 x18，GREEN 为中间 x17，50ms 达 x18。无需改 Renderer。
4. 非 playing 时 submitInput 不存输入，时钟也不发送/预测，接到终局清 pending 与按键状态。结算继续 240 次采样的 RED 为 240 包，GREEN 为 0 包；死亡保持 playing，respawn command 不受影响。
5. room 回 lobby 时，adapter 先 dispose/null 旧 session 再通知订阅者；App 房间回调解绑旧订阅、清 session/input/menu/spectator，保留 lobby/socket，实际显示准备大厅。RED 为回调仍读到旧 session，GREEN 为 null 且 ready 仍通过同 socket 发送。新增比赛按既有 onSession 路径进入。

测试命令：`npx tsx --test tests/network.test.ts`；全部 16/16 通过。`npx tsc --noEmit` 通过。新增客户端时序用例仍运行真实 WebSocket，测试服务器只提供公开协议帧，快照由真实 Simulation 生成；注入的是时钟而非预测实现。没有私有成员断言。

需要主代理最终浏览器验收的具体动作：两人开局→结算→房主“再来一局”→双方真实界面显示准备大厅→再次准备开局。协议与 adapter 回归已覆盖；本报告不把 Node 测试说成浏览器 UI 实测。

## 2026-09-26 后台输入释放

页面隐藏时渲染采样停止，但 NetworkSession 的 60Hz 时钟继续运行。之前会持续发送最后一次移动和开火状态。现在会话在 `visibilitychange`（隐藏）和窗口 `blur` 时将输入归零，保留 yaw/pitch，释放一次性操作；`dispose` 移除两个监听器。测试通过 NetworkLobby 会话公开 `submitInput` 与真实 WebSocket 消息观察行为，使用可控时钟和页面事件，未调用私有方法。该测试先 RED（隐藏后仍发送 moveX=1），修复后 GREEN；`npx tsx --test tests/network.test.ts` 为 17/17，`npm run typecheck` 通过。

服务器永久停止的生命周期随后补齐：NetworkLobby 新增 `onEnded(reason)`；明确的服务器结束关闭码 4000、策略关闭码 1008、恢复凭证被拒绝或超过 29 秒重连窗口时，释放旧会话并通知。普通临时断线仍保留会话尝试恢复。App 在该通知中调用 `leave()` 回首页并显示结束原因。真实 WebSocket 的服务器结束用例先 RED（公开 `onEnded` 不存在），实现后 GREEN，并验证回调时会话已清空、旧会话不再发送输入。网络测试 18/18，`npm run typecheck` 通过；29 秒计时边界和浏览器界面尚未实测。
