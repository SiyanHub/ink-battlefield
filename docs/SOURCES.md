# 来源与本地依赖

## 原 Demo

原项目保留在本工程相邻目录，不复制其 `.env`、部署缓存、账号配置或密钥。

- `手绘风射击游戏/src/render/DoodleMaterial.ts` → `src/client/render/DoodleMaterial.ts`：复用纸面、圆珠笔排线的着色算法。
- `手绘风射击游戏/src/render/palette.ts` → `src/client/render/palette.ts`：复用暖纸蓝墨色板。原工程根 LICENSE 为 Apache-2.0，副本保存在 `licenses/shooting-demo-Apache-2.0.txt`。
- 射击 Demo 的移动/枪械/场景分层是行为参考；新共享碰撞、武器规则、模式和权威服务为本工程重新实现，不加载原有大型游戏控制器。
- `手绘风水墨/Opus5.5`：参考彩墨飞溅、纸面扩散与混色的视觉方向。新版本的墨迹使用固定表面网格和 CanvasTexture 持久保存；没有复制原 Demo 的短寿命墨迹管理或本地配置。

保留原 Demo 不等于替原 Demo 发布新许可；本次交付仅本地工程，没有创建公开仓库或部署。

## 依赖

- Three.js 0.180.0，MIT，许可证 `licenses/three-MIT.txt`。
- ws：锁定版本见 package-lock.json，MIT，许可证 `licenses/ws-MIT.txt`。
- Patrick Hand：随 npm 包本地打包，SIL Open Font License 1.1，许可证 `licenses/Patrick-Hand-OFL.txt`。中文使用操作系统已有字体，不加载网络字体。
- TypeScript、Vite、tsx 为开发/启动工具，确切版本由 package-lock.json 固定。

模型、武器、场景几何、纸张和彩墨效果均程序化生成；声音使用本地 Web Audio 合成。运行中不请求 CDN、外部素材、遥测、账号或公网匹配。

## 2026-09-26 武器造型修订

对照水墨 Demo 的 `src/main.js` 铅笔段落（六棱笔杆、削木、石墨、金属箍和橡皮的连续结构），以及射击 Demo 的 `src/combat/viewmodels.ts`（侧面轮廓、枪托、握把、瞄具和分件动作设计）。本次在 `src/client/weapons.ts` 重新编写尺寸一致的造型构造器，在 `weapon-view.ts` 单独管理第一人称持握和动作。保留蓝墨暖纸材质；未复制原项目配置、部署目录或凭据。

## 2026-10-21 Opus 主视觉重构

`手绘风水墨/Opus5.5/src/sketch.js` 的顶点/片元着色器适配到 `src/client/render/sketch-shaders.ts`，保留来源标注；对当前 Three 颜色管理加入线性到显示色转换，调整排线阈值、线条抖动和色度保护。`SketchPipeline`、`PaperTextures` 与 `WeaponPaper` 为本工程新实现。角色参考原 Opus 的关节纸人方向重建，尺寸遵循共享命中几何。当前运行管线不再使用旧 `DoodleMaterial`；该文件及色板仅留作来源参考，不导入生产入口。

该轮重构最初仅本地交付，未改变原 Demo 许可。

## 2026-10-21 发布

用户授权上传 GitHub 与 Vercel。新工程发布至私有仓库 `SiyanHub/ink-battlefield`，Vercel 项目为 `siyan1/ink-battlefield`；保留上述来源与许可证。原 Demo 目录、账号配置、测试截图和本地备份没有上传。正式网页只提供构建产物，局域网房间仍由本地启动脚本运行。
