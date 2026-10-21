# 联机服务重构记录 / 2026-10-21

## 实现与边界

原 `src/server/server.ts` 的 541 行服务拆为按所有权与职责组织的模块。公开 `createGameServer(options)`、返回的 `server / port / close`、`/ws` 地址和所有消息字段保持兼容；没有增加平行协议或另一套模拟规则。没有修改 `session/network.ts`、共享契约、内容地图、游戏平衡或武器开放策略。

| 文件 | 负责的行为及所有权 |
| --- | --- |
| `src/server/server.ts` | 组装 HTTP、WebSocket、房间注册表和调度器；监听成功后开始调度；关闭时停止调度、释放房间状态、终止连接并关闭监听器。 |
| `src/server/connection.ts` | 单连接身份引用、5 秒握手截止、每秒 150 条限流、1 MiB 发送背压、错误回复与关闭回调；拒绝重复身份，显式离开清除身份引用。 |
| `src/server/protocol.ts` | JSON 消息格式、昵称/凭证格式、房间设置、输入数值/字段、职业装备和重生命令校验。动态 JSON 读取集中于此，传入房间的消息使用 unknown 字段边界。 |
| `src/server/rooms.ts` | 每个服务器实例独立拥有房间表、凭证表与重连租期；创建/加入/退出、权限、准备/开赛/重赛、完整状态恢复及房主移交；关闭后清理定时器、输入队列和成员房间引用。 |
| `src/server/scheduler.ts` | 8 ms 唤醒、最多 250 ms 积压、60 Hz 固定模拟、每位玩家每步消费一条有序输入、每三步广播快照与事件；结算后停止该房间模拟。 |
| `src/server/static-http.ts` | 只从指定构建目录提供 GET/HEAD；路径、实际文件位置、文件类型、缓存及 MIME 处理。 |
| `src/server/state.ts` | 服务内部成员/房间状态、依赖签名与服务器选项；无进程级共享可变状态。 |
| `tests/network.test.ts` | 新增真实 HTTP 目录 junction 越界回归。 |

保留 2–8 人、三种竞技模式、服务器权威、输入序号去重与队列上限、60 Hz 模拟 / 20 Hz 快照、默认 30 秒重连、完整彩墨恢复、断线中立输入、房主移交、合法重生装备、结算后重赛及会话销毁。浏览器客户端预测、插值、输入采样代码未改动。

## 发现的缺陷与先红后绿证据

旧静态服务只校验词法路径。如果 `dist/linked` 是指向构建目录外部的 Windows 目录 junction，访问 `/linked/secret.txt` 会实际读取外部文件。

先新增公开 HTTP 用例，在临时目录中创建独立的 dist、外部文件和 junction，不读取真实项目私密文件。命令：

```powershell
node --import tsx --test --test-name-pattern="directory junction" tests/network.test.ts
```

修改前真实响应为 `200`，断言期望 `403`，用例失败。最小修复是对根目录与目标文件调用 `realpath`，在读取前检查目标仍位于实际构建目录内；随后同一用例通过。重构沿用这个已变绿的实现。测试清理前校验临时路径前缀，删除仅限该测试创建的临时目录。

## 验证

- `npm run typecheck`：通过。
- `node --import tsx --test tests/network.test.ts tests/eight-players.test.ts`：22/22 通过。包含 2 人开赛、8 条真实 WebSocket、容量/权限、过期及重复凭证、断线恢复、完整彩墨恢复、有序短跳输入、限流/超大消息、重赛、客户端采样/预测/插值和结束清理。
- 本代理最后一次 `npm test`：75 项中 74 通过；唯一失败是并行 UI 重构中的 `objective room locks the team toggle while deathmatch leaves it selectable`，原 UI 测试替身没有新运行时状态，已通知 UI 代理与主代理。这里记录当时快照；最终全量验证由主代理合并当前工作后执行。

没有把内部模块结构断言当作网络行为验收，没有创建镜像式测试。网络测试使用本机真实 HTTP/WebSocket；这不代表两台实机的防火墙、无线网络延迟或长时间多人压力已经验收。本代理未运行浏览器、未提交或推送 Git。
