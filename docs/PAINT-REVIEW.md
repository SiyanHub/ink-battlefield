# 局部墨迹优化审查

审查范围：`src/client/paint.ts`、`src/client/paint-raster.ts`、`tests/paint-raster.test.ts`，并只读追踪 `PaintField`、`PaintPresentation`、`Renderer` 与网络快照来源。本轮未修改应用代码、未运行测试或浏览器；既有 65/65 测试结果未在本轮复验。旧版每表面更新重画 19915 格、1080p 约 35 fps 是任务提供的基线，不是本轮测量值。

## 结论

这次优化在当前权威快照契约下基本正确：每个表面只有一张 `CanvasTexture` 和一个平面 mesh；染色数据由 `PaintField` 固定网格保存，短寿命 `effects` 回收不会删除表面墨迹。重涂时旧颜色所在瓦片被清除，再按快照顺序重画该瓦片全部相交墨迹；同图新局通过 `resetSession` 清空画布和 revision，再应用新快照。缓存只保存当前有色格及其瓦片关联，随固定网格有界，不积累历史笔触。

局部 CPU 重画成立，但还不能据此宣称 1080p 帧率已改善到目标值：每次变更仍遍历整个表面快照并构造 `next`/`order`，`CanvasTexture.needsUpdate` 也可能触发整张纹理上传。本轮没有浏览器像素对照或性能实测。

## 范围与叠色核对

- `draw` 保留每格 12 点多边形：`r = .67 + sin(index*7 + j*13)*.13`，最远 `.8` 个 cell；3 个卫星圆中心在各轴最多 `.8` 个 cell，半径 `max(1, cellX*.08)`。颜色、圆的 `globalAlpha=.4` 和绘制次序均与给定旧版描述一致。
- `forSpotTiles` 在 X/Y 方向均以 `.8*cell + radius` 包围整个绘制范围。它对 Y 方向把圆半径也加上，属于安全放大；边界用 `floor` 和表面瓦片上限裁剪，因此恰好压在 64 px 边界的笔触也会使邻瓦片重画。瓦片清除后有裁剪路径，重画相交格不会擦掉相邻瓦片。
- `bins` 将每个格索引登记在其笔触可能触及的所有瓦片。颜色变化和删除先将旧索引覆盖的瓦片标脏；新增索引登记并标脏。重画时从该瓦片的当前 bin 取全部索引，按当前快照位置排序，再逐格画；因此重叠圆的透明叠色不会仅因局部更新而改变顺序。首次全画也使用快照格顺序。
- `PaintField.snapshot()` 从 `Map` 输出完整现存格；`Map.set` 重涂现有格不会改变插入顺序。网络增量合并同样用 `Map.set` 保持既有格位置。因此正常路径中只按颜色判断 dirty 与重绘顺序相容。若未来输入允许同色但格顺序重排，当前 `apply` 不会标脏，透明重叠区可能保留旧叠色顺序；这是快照顺序契约的潜在风险，不是已证实的现行故障。

## 生命周期与上界

- 核心 `PaintField` 的 cells 位于固定表面网格中，`stamp` 对同一索引覆盖旧格；`Renderer` 的瞬时特效在独立 `effects` 数组中回收，不持有表面颜色。`PaintPresentation` 把完整快照里消失的表面当作清空。重连由网络会话合并或恢复完整 paint，`PaintView` 再按 revision 更新。
- `Renderer.resetSession` 调用 `paint.reset()`，它清除颜色、bin 和 canvas，并置纹理待上传；随后立即应用当前快照。同地图也不会沿用上一局 revision。`PaintRaster.clear()` 在 colors 已空时直接返回，这依赖画布与缓存始终同步；当前正常路径满足这一点。
- 纹理尺寸每轴限于 64–1024 px；每表面一个 canvas、纹理和平面。`colors` 至多有该表面格数个条目，`bins` 至多有 `ceil(width/64)*ceil(height/64)` 个瓦片，每条关联来自当前格的有界笔触范围。没有按格创建 mesh，也没有无限历史列表。上界不等于低常数：满涂时格映射和 bin 集合仍会占内存。

## 验证缺口与建议

现有 `paint-raster.test.ts` 记录 `clearRect` 和 `fill`，覆盖重涂后旧色不再参与重画、邻格参与局部重画，以及满画布单格变化的重画数上界。其 canvas mock 不记录真实像素、裁剪或 alpha 合成，所以无法证明 64 px 边界和重叠处没有残影；也未覆盖删除格、`clear/reset` 后同 revision 新局、遗漏表面清空。建议在接受视觉与性能结论前，做实际 Canvas 像素对照（全量重画 vs 局部重画，包含边界、重叠、删除和重开）以及 1080p 满涂情况下的浏览器 CPU/GPU 与帧率测量。
