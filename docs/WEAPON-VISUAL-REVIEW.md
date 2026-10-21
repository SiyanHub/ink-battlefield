# 武器造型修订 / 2026-09-26

## 问题与方向

旧铅笔使用通用枪身，笔杆过粗；枪械缺少完整结构；全部武器复用一个镜头距离；没有与握把对应的手部。用户明确反馈不如 Opus 原 Demo。本轮按实际参考源码重建造型，而不是仅替换颜色。

枪械使用有厚度的侧面轮廓，分出枪身、枪托、握把、供弹、瞄准、枪口。文具按真实物件的连续结构构建，仅用小范围彩墨作为功能点缀。模型原点、尺寸单位和朝向统一，第三人称与第一人称共用本体；第一人称独立加手套/袖口和动作。

## 实施边界

- `src/client/weapons.ts`：16件模型、构造辅助函数、稳定 model ID 映射。
- `src/client/weapon-view.ts`：持握表、手部、装备/后坐/换弹/蓄力/挥击。每次换武器释放旧模型，效果复用固定对象。
- `src/client/renderer.ts`：装配 WeaponView，以独立固定视角绘制第一人称，清深度防贴墙穿模；统计包含世界与武器两个绘制阶段。
- `weapon-review.html`、`src/weapon-review.ts`：仅开发用的可重复视觉检视，不改存档、不绕过正式游戏解锁。

换弹仍是风格化的分件动画，不是完整的装填机械仿真；角色第三人称基础骨架未在本轮重做。

## 验证证据

- 新构建通过，包括 TypeScript：`artifacts/build-weapon-revision.txt`。
- 回归68/68通过：`artifacts/tests-weapon-revision.txt`。
- 浏览器48次切换，三轮末尾资源计数均568几何体/0纹理：`artifacts/weapon-view-cycles.json`。包含检视总览的16个常驻模型；没有把这个数字当作正式战斗帧率结论。
- `artifacts/screens/weapons-redesign-gallery.png`：16件完整轮廓。
- `artifacts/screens/weapons-redesign-pencil.png`：铅笔第一人称。
- `artifacts/screens/weapons-redesign-live-pencil.png`：生产构建的涂绘战役。
- 实际操作铅笔射击，HUD从32/192降到16/192，R换墨后恢复32/176；鼠标锁定受内置浏览器限制，使用已存在的拖动射击回退。

视觉判断：已去掉文具枪身拼接，笔尖/轴架/铰链连续，枪械结构可辨识。整体美术质量和玩家满意度需要用户复核，自动测试不评价美术好坏。
