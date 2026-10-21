# 客户端实现任务

你负责新游戏的浏览器表现与界面。工作目录为本文件的父目录的父目录。只编辑 src/client/**、src/main.ts、index.html、tests/ui.test.ts、docs/CLIENT-REPORT.md。不要修改 shared/content/core/session/server/profile 目录和 package.json，协调接口给主代理。无需提交或发布。原 Demo 不能修改。

先读 src/shared/contracts.ts，所有接口已确定。主代理会实现 src/content/index.ts exports weapons/classes/maps/enemies/upgrades 为 Record<string,Definition>，各类型已定义；src/session/local.ts export createLocalSession(options:{classId:ClassId;weapons?:string[];profileStore:ProfileStore;checkpoint?:Checkpoint}):GameSession；src/profile/store.ts export ProfileStore 类，constructor(storage?:StorageLike),load():Profile, save(profile:Profile), unlockedWeapons(classId):string[], updateSettings(partial), clearCheckpoint()。

联网 src/session/network.ts 将 export NetworkLobby 类：constructor(url:string); connect(name:string):Promise<void>; subscribeRoom(fn:(room:RoomSnapshot)=>void):()=>void; onError(fn:(message:string)=>void):()=>void; create(settings:RoomSettings):void; join(code:string):void; configure(settings:Partial<RoomSettings>):void; choose(classId:ClassId,weapons:string[],teamId?:string):void; ready(value:boolean):void; start():void; rematch():void; getSession():GameSession|null; onSession(fn:(session:GameSession)=>void):()=>void; disconnect():void。默认地址与当前网页同源 /ws，Vite 开发时 localhost:8903/ws。出现实际断线要明显提示。

实现高质量中文完整游戏 UI 和 Three.js 客户端：温暖纸面、蓝色球珠笔线稿、手写英文字体可用 @fontsource/patrick-hand，中文系统字体。参考 ../手绘风射击游戏/src/render 的 DoodleMaterial/OutlinedMesh/palette（可以复制并归入 client/render，保留来源）；可以参考程序化武器和敌人 rig。主菜单需真实渲染场景背景，不要只有平面dashboard。UI 精致、自然纸面排版、功能清楚。

地图从 maps[id] boxes 创建，共享物理几何，只在客户端添加不挡路的装饰（笔记本字、圈划、路标、脚手架、云太阳等）。根据 PaintSurface 定义用 u/v/normal 构造贴图平面，persistent PaintSnapshot 的 cell 元组 index/color/owner 转换为持续画布纹理，边缘不规则渗染，保持蓝线可读；不能退化成硬方格。cells 的网格宽度为 ceil(surface.width/cellSize)，索引 row*width+col，局部坐标以 center 为原点，u/v 对应图像横纵。角色 kind player/enemy 姿态有动画；4职业可视差异，6敌人和3boss的行为由 core 提供，渲染创建对应形体。16武器模型和动画要能明显识别，非仅换颜色。远程攻击、近战、蓄力、换弹、喷墨、爆破按 snapshot 和 events 表现。color 为 packed RGB。Actor pos 是脚底，玩家眼高1.62。事件每帧仅处理一次。

输入 WASD、Shift、Space、鼠标左右、1/2/3、滚轮切槽、R换弹、Q钩索、E技能、Esc菜单、Tab归属/比分。Pointer Lock 使用真实点击；失败给合理降级而非假暂停。InputFrame 用持续 primary/secondary 和一次性 jump/skill/grapple/reload/slot，seq单调；GameSession 接收不直接改状态。俯仰pitch负向向上与Three常规YXZ一致，请和主代理确认。

玩家操作边界已获TDD授权：先建立一个真实用户可观察UI状态测试（可用纯UI presenter公开接口，node测试），运行失败，再最小实现，逐步补菜单/死亡换职/升级选择等。不要做DOM字符串常量自证式测试。浏览器由主代理实际验收。需要真实可点击菜单包含：单机四职卡片/装备锁、继续单机、设置（音量敏感度画质reduceMotion），局域网昵称地址房间号/开房加入/模式地图队伍装备准备开始，HUD生命弹药技能钩索任务比分进度，单机升级三选一及补给换装继续，暂停，死亡/胜利，局域网死亡职业/装备选择，赛后保留战场/再来一局/退出。局域网Esc不能停止session。

注意import内容尚在创建但契约稳定，不要因短暂缺文件停止。每模块职责清楚，主入口仅装配，避免巨大Game类。建议Renderer/World/Actors/WeaponView/PaintView/Effects/Audio/Input/UI/App分离。保存你的测试证据到报告。完成后报告 DONE / concerns，勿声称已浏览器验证。可自主在授权目录完成所有必需文件。
