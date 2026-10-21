# 网络模块任务

工作目录墨绘战场。只编辑 src/server/**、src/session/network.ts、tests/network.test.ts、docs/NETWORK-REPORT.md、scripts/**、启动局域网.ps1、启动单机.ps1。不改根package和shared/core/client。模型行为不可在服务器再写一份。无提交、无部署、不能改原demo。不spawn其他implementer。

主代理已写 src/shared/contracts.ts（必读）和 src/core/simulation.ts。Simulation接口：new Simulation({modeId:string,mapId?:string,map?:MapDefinition,teamMode?:boolean,seed?:number});addPlayer(id,name,classId,requestedWeapons=[],teamId=id,spawn?);removePlayer(id);input(id,InputFrame);command(id,SessionCommand);step()固定1/60秒;takeFrame():GameFrame排空events;getSnapshot():GameSnapshot。主代理将增加 acknowledgedInput(id):number 返回实际已处理seq。你不能访问 rt 内部。默认3竞技modeId deathmatch/control/turf, solo只本地。

实现 Node HTTP 同端口8903 /ws（本机127.0.0.1，--lan时0.0.0.0），严格只serve dist，禁止源码/.env/任意遍历，流媒体cache支持无需extra。frontend dev8902 连接ws8903; browserprod同源。ws dependency已安装，原生浏览器WebSocket。Windows launcher检查node依赖且首次构建，LAN输出所有IPv4本机链接，私有网络防火墙失败给真实排障不自动全局放行。

实现in-memory房间2–8真人，无机器人、无公网账号；每房间独立simulation。昵称最大20，可重复；身份唯一server生成，提供opaque reconnect token。create、join(code)、configure(hostOnly)、choose(class/weapons/team)、ready、start(hostOnly,>=2 ready connected,teams valid)、rematch(hostOnly,finished)->返回lobby等待ready、leave。人数包括断线保留，断线30秒可恢复；到期移除，有活人则转交host管理员。所有human离开清room并stop timers。serverstop客户端显示真实disconnect。区分浏览器退出房间与临时掉线。入场满员/比赛已开始/非法class/loadout/schema重复seq处理。非法伤害字段不能生效。输入字段布尔类型、整数seq、有限数/范围必须验证，请不直接spread unknown对象。消息限速和包大小（合理150/s,16KB）避免内存失控。

服务器固定60Hz累积步进，20Hz广播。snapshot通常去除完整paint，仅发送paint事件变化；首次start/join/reconnect发送全快照，包括地图墨迹以恢复；客户端合并后始终给UI完整GameSnapshot。事件去重。若重连时paint区域字段缺省避免把它误当空地图。网络过载backpressure有上限。服务端流游戏规则始终Simulation。

src/session/network.ts export NetworkLobby：constructor(url:string);readonly playerId:string;connect(name:string):Promise<void> welcome后resolve;subscribeRoom(fn:(RoomSnapshot)=>void):()=>void;onError(fn:(string)=>void):()=>void;create(settings:RoomSettings):void;join(code:string):void;configure(settings:Partial<RoomSettings>):void;choose(classId:ClassId,weapons:string[],teamId?:string):void;ready(boolean):void;start():void;rematch():void;getSession():GameSession|null;onSession(fn:(GameSession)=>void):()=>void;disconnect():void。GameSession见shared；getSnapshot在onSession时必须已可用。session.dispose只能解绑旧session，不关闭新的NetworkLobby.socket，避免重赛关闭新session。disconnect负责关连接和重连timer。App.start会dispose旧session再subscribe新session。same-match reconnect不重置用户角色，只全state同步。

客户端实现预测校正：复用core/world.ts movePlayer/World，不复制移动规则。用服务器ack重放未处理移动输入，最多128个。远程actor插值由客户端渲染已有？检查client/renderer.ts确认并补适配在network，禁止直接改client。最低不能假称有预测却只是重复显示lastsnapshot；core物理规则升级effect速度会主代理配合。

TDD被用户批准真实网络公开协议边界。先写一个真实WebSocket建房/准备/2人开局失败测试（代码未有），运行RED，然后最小GREEN；增加满员8、拒绝非法操作/伤害、重连、重赛等切片。测试创建server host127.0.0.1 port0以避免冲突，shutdown清所有timer/ws。导出createGameServer(options)返回{server,port,close}等合理可测接口。不要test私有函数和固定文本。把RED/GREEN命令和结果写入报告。主代理负责final browser/8连接/实机声明边界。
