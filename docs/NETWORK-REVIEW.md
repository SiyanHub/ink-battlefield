# 网络模块独立审查

## 修复复审

**原五项均已关闭。需求轴原发现通过复审；质量轴发现一项输入生命周期问题仍需处理（P2，见下）。** 本轮读实际修改及新增测试，未重复执行已通过测试、未使用浏览器。旧版审查保留在后面，旧行号为当时版本。

| 原问题 | 修复链与结论 |
| --- | --- |
| 重赛不能回大厅 | `network.ts:46` 在 room=lobby 时先 dispose/null session，再通知；`app.ts:161-179` 清自己持有的旧 session/订阅/输入/观察状态并显示 room。socket 保留，NetworkLobby.playerId 用于自身身份。关闭。 |
| RAF 发送/预测时钟 | `network.ts:12-21` 将 submitInput 降为持续状态采样和脉冲锁存，固定 1/60 累计器负责发送与预测；`server.ts:46,65` 每 step 消费一项有界输入队列，ack 仍由 Simulation 返回。30/60/120/240Hz 新测试针对时间/发送数边界，而非只比较代码常量。关闭原刷新率问题。 |
| 插值未显示 | `network.ts:24-33` 的 getSnapshot 返回实际供 App.loop/Renderer.draw 消费的远端插值副本，预测继续使用内部 snapshot；超过6m或生死变化不插值。关闭。 |
| 终局输入洪流 | `network.ts:13,19,21` 在非 playing 时清/拒绝输入，不再发送；receive 清 pending/latest。关闭。 |
| 失败握手身份残留 | `server.ts:56` 验证局部 candidate 成功后才赋 member；拒绝后后续请求仍走未认证检查。关闭。 |

### 新发现 P2 — 隐藏页面时固定发送器继续执行最后的移动/开火

- 位置：`src/session/network.ts:11-16,21,35`，集成来源 `src/client/input.ts:36` 与 `src/client/app.ts:469-516`。
- NetworkSession 固定 interval 持续发送 latest；latest 仅由 App 的 RAF 调 submitInput 更新。Input 的 blur 清理只改变 Input 实例，不改变已缓存在 NetworkSession 的 latest。切到其他标签页导致 RAF 暂停时，后台 interval 仍可能运行（即使被节流），持续发送切换前的 W/primary=true；服务器也会一直沿用最后持续状态。
- 触发路径：在线按住 W 或左键 → 浏览器失焦并隐藏标签页，松开键/鼠标在外部 → 客户端 RAF 不再及时提交 neutral。旧状态仍成为下一次固定发送步的输入。这是本地控制器失焦清理没有传播到会话的生命周期缺口，不是网络掉线恢复问题。
- 最小修复：联网会话/装配层在 blur/visibilitychange hidden 时立即清 latest 的持续状态和脉冲，发送或优先排入 neutral；避免后台调度器再恢复旧值。dispose 移除新增事件监听。可以用注入时钟+公开 DOM 事件边界检查“已按下→blur/hidden→推进时钟”的出站输入，无需重复既有频率测试。

当前结论：原需求 4 项与原质量 1 项关闭；新增质量 P2 待修复。真实两人重赛界面、Pointer Lock 与 LAN 双机仍属最终浏览器/设备验收边界。

## 初次审查（历史记录）

范围：`docs/NETWORK-BRIEF.md`、`docs/NETWORK-REPORT.md`、`artifacts/network-review.txt` 对应全部新增网络文件，以及现有 client/core 的公开消费链。只读审查，未改应用、未重复运行已通过的 29 项全套/9 项联网测试，未浏览器操作。以下行号对应本次审查源码。

## 需求轴：需要修改

### P1 — 正常界面无法完成重赛回大厅流程

- 位置：`src/session/network.ts:28,46-47`；相关消费方 `src/client/app.ts:161-171`。
- 服务端 rematch 正确清 simulation 并广播 lobby，但适配器仍返回旧 NetworkSession，App 自己的 session 也保持非空；房间回调只有 `!this.session` 才渲染大厅。点击“再来一局”后仍在旧结算画面，无法用界面重新配装、准备和开始。
- 最小修改：当房间从 finished/playing 变为 lobby 时，明确结束旧 session 并通知/允许 App 切回大厅。需要客户端消费方一起处理 App.session/unsubscribe/input，而不是只在 NetworkLobby 内置 null；保留 socket 和房间身份。
- 已有重赛测试直接给 WebSocket 发 ready/start，未覆盖这条 UI/adapter 生命周期，因此其通过不能排除问题。

### P1 — 输入发送和预测时钟绑定屏幕刷新率

- 位置：`src/session/network.ts:13,37`；输入来源 `src/client/app.ts:460-491`；权威处理 `src/core/simulation.ts:13-15,19-29`。
- App 每 RAF 调 submitInput；adapter 每次直接发一个消息，并固定预测 1/60 秒。240Hz 显示器每秒约 240 包，超过服务端 150/s 规则而被踢；120Hz 下每个真实秒预测两秒，30Hz 则预测半秒，随后反复被权威快照拉回。
- 服务端 Simulation.input 保存最新输入而非逐帧队列，同一个模拟 tick 前到达多帧时瞬时 jump/reload/skill 等也可能被后来的 false 覆盖。每条 pending 一律重放 1/60 不等于服务端真正处理的模拟步长。
- 最小修改：adapter 按独立固定 60Hz 时间累计器发送/预测，合并持续状态并锁存瞬时输入到发送点；明确 server tick 的消费与 ack 语义，让 pending 代表相同模拟步长。服务器的 150/s 安全限速应继续保留。

### P2 — 远端插值没有进入实际渲染快照

- 位置：`src/session/network.ts:8,16`；`src/client/renderer.ts:154-157,230-258` 和 `src/client/app.ts:463,498-503`。
- animate 创建插值 frame 并 emit，但不保存为 getSnapshot 返回值。Renderer.frame 只接收墨迹和事件；角色姿态来自 draw 的 s，而 App 给 draw 传入 getSnapshot。最终角色仍是 20Hz 权威位置，插值副本被丢弃。
- 最小修改：adapter 分开保存权威/预测状态与显示状态，让 getSnapshot 返回供 draw 使用的插值显示快照；不要让下一次预测或插值再把显示状态当权威基线。或者显式让 renderer 消费插值姿态，但本任务客户端目录边界需要主代理协调。

### P2 — 结算后继续发送输入造成错误提示洪流

- 位置：`src/session/network.ts:13,37`；服务端 `src/server/server.ts:65`。
- 客户端对 session 的 RAF 调用在 victory/defeat 仍持续。submitInput 先发送再仅条件性预测；服务器对 finished 房间每包返回“比赛尚未开始”。这使正常结算期间约每秒 60 条 onError/toast，并不断创建提示定时器；高刷时还会触发限速。
- 最小修改：NetworkSession 在非 playing 阶段不发送 input、不增加 pending；返大厅时停旧 session。死亡期间 phase 仍 playing，可按需求发送中性控制，勿误阻止 respawn command。

## 代码质量轴：需要修改

### P1 — 拒绝重复重连后，连接仍绑定了被拒绝的身份

- 位置：`src/server/server.ts:56,60-76`。
- hello 的 token 分支先执行 `member=tokens.get(m.token)`，随后才检查 member.connected 并抛错。如果 token 对应仍在线成员，虽返回“重连凭证失效”，该新 socket 的闭包 member 已指向该成员。随后在该 socket 发送 configure/input/leave 会以该身份继续处理，完全绕过失败握手；leave 可移除仍在线的成员。客户端正常会关 socket，服务器不能依赖客户端遵守这一行为。
- 最小修改：先用局部 candidate 查找并完成所有凭证/在线状态检查，再绑定 member 和 ws；失败时 member 始终 undefined，或明确关闭连接。所有身份变更只在验证成功后提交。
- 这不意味着 token 可被猜测；问题是服务端已明确拒绝的会话仍被当作已认证处理。同 token 重复连接即可触发，无需伪造伤害字段。

## 已符合及边界

- 房间独立 Simulation、固定步进和 20Hz 广播、真实 ack、完整首次状态/墨迹增量合并、无直接 rt 访问、host 权限、人数/准备/队伍校验、输入逐字段验证及防伪 damage 均有实际实现。
- 断线使用中性输入，30 秒保留/token 恢复，过期移除/host 转交，最后成员删除 room；关闭入口清调度器、保留计时器并 terminate socket。旧 session.dispose 不关闭 lobby socket。
- HTTP 限 GET/HEAD、在 dist 根下解析并拒绝点路径/反斜杠；常规源码/.env/遍历不落入根外。启动器检查 Node、安装缺失依赖、构建并输出 LAN 排障，不自动改防火墙。本轮未发现正常构建产物路径的暴露问题。
- 入站 16KiB、150/s；服务端出站 bufferedAmount 超过 1MiB 关闭慢连接。客户端无限制逐 RAF 发送是上述具体问题，不否认服务端限额本身存在。
- 现有预测测试只断言一次 submitInput 后位置变化，不能证明不同刷新率下时间一致；插值没有经实际 draw 边界验证。没有要求重跑现有成功测试，修复时应补对应失败路径的窄范围回归。

结论：需求轴 4 项（最高 P1）；质量轴 1 项（P1）。不能按目前网络报告直接判定完整集成通过。优先修复失败握手身份绑定、正常重赛状态与固定输入时钟，再完成插值显示和结算输入门控。
