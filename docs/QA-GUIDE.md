# 本地 WebGL 染色压力测试

运行 `npm run dev`，打开 `http://127.0.0.1:8902/qa.html`。这是独立开发 QA 入口；常规 `vite build` 仍只构建 `index.html`。将浏览器内容区设为 1920×1080 并保持标签页前台，点击「开始 30 分钟」。页面到实际墙钟 1800 秒自动停止，不会以模拟时间代替真实持续时间。

计时前有2秒武器/材质预热，随后重新开始完整1800秒测量。后台内置浏览器即使报告visibility为visible，也可能被宿主限到1fps；请确认窗口真实前台且模拟时间紧跟墙钟。长帧数、最大帧间隔、hiddenDuringRun一并记录。被限帧时停止并标记无效，不能算性能通过。

「校验墨迹像素」在未运行压力测试时可用。它比较增量重涂与干净画布全量重画，两种Canvas配置各5个场景，结果在页面显示。初版真实对照发现边缘抗锯齿差异，改用同尺寸工作画布后10组零差异；这比只记录绘图调用的单元测试更直接。

测试通过公开的 `PaintField.stamp()` / `snapshot()` 预先为正式地图的所有可用表面填入持久彩墨，并把快照交给 `Simulation.initialPaint`。同队 8 名画师切换到滚筒，持续移动和开火；固定步长为 1/60 秒，渲染使用正常 `Renderer.frame()` 和 `Renderer.draw()`。30 分钟测试在同一局内持续，不自动重开。独立的「重复重开 10 次」检查会轮换正式地图并调用正常 `Renderer.resetSession()`，每次记录几何体、贴图、程序、绘制调用和三角形数，用于判断资源是否达到平台期。「采样 30 秒」用于快速排查，不能代替 30 分钟验收。

指标 JSON 直接显示在页面，也可下载。重点看 `elapsedWallSeconds`、`simulatedSeconds`、`rafAverageFps`、`rafFrameMsP50Rolling/P95Rolling`、`paintCells`、`renderer` 与 `resetSamples`。平均帧率覆盖整次运行，P50/P95 是最近最多 3600 帧的窗口。测试结束后结果冻结。帧率是浏览器 RAF 间隔统计，不是纯 GPU 耗时；`renderer.info` 是 Three.js 的资源和上一帧绘制计数，不能当成显存字节。浏览器标签页隐藏或出现超过 250 毫秒的长帧时，`valid` 将保持 `false`。设备休眠或窗口分辨率不符时需要重新测量。固定步进每帧最多追赶 5 步，负载过高时 `simulatedSeconds` 会落后于墙钟，这本身是失败信号，不会伪造 60 Hz 达标。
