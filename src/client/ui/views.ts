import { teamInk } from "../../shared/ink";
import { renderTurfScore } from "./turf-score";
import { challenges } from "../../profile/challenges";
import { classes, maps, upgrades, weapons } from "../../content";
import { upgradeAppliesToWeapon, upgradeWeaponRequirements } from "../../content/upgrades";
import type { GameSnapshot, RoomSnapshot } from "../../shared/contracts";
import { overlayFor, resultTitle } from "../presenter";
import type { GameController, UiState } from "./controller";
import { button as btn, classCards, controls, equipment, esc, panel } from "./components";

function upgradeHint(id: string, state: UiState) {
  if (!upgradeWeaponRequirements[id]) return "";
  const role = classes[state.selected];
  const available = [...role.weapons, role.melee].filter(weapon => upgradeAppliesToWeapon(id, weapons[weapon]));
  const equipped = available.filter(weapon => state.loadout.includes(weapon));
  return `<small class="upgrade-fit">${equipped.length ? "当前受益：" : "换装后生效："}${(equipped.length ? equipped : available).map(weapon => esc(weapons[weapon].name)).join("、")}</small>`;
}
export function saveWarning(game: GameController) {
  return game.store.hasUnsavedChanges ? `<div class="save-warning" role="status">本次进度尚未保存，关闭页面可能丢失。${btn("retry-save", "重试保存")}</div>` : "";
}
export function roomView(room: RoomSnapshot, state: UiState, team: string, playerId?: string) {
  const host = !playerId || room.hostId === playerId;
  const disabled = host ? "" : "disabled";
  const requirements: string[] = [];
  if (room.members.filter(member => member.connected).length < 2) requirements.push("至少 2 位在线玩家");
  if (room.members.some(member => !member.connected)) requirements.push("所有玩家在线");
  if (room.members.some(member => !member.ready)) requirements.push("所有玩家确认装备并准备");
  if (room.settings.teamMode && (
    room.members.some(member => !["blue", "red"].includes(member.teamId)) ||
    new Set(room.members.map(member => member.teamId)).size !== 2
  )) requirements.push("蓝墨队与朱墨队各至少 1 人");
  const startHint = requirements.length ? `开局条件：${requirements.join("；")}。` : "所有玩家已准备，可以开始对局。";
  return panel(`房间 ${esc(room.code)}`, "联机画室 / 等待落笔", `<div class="room-options"><label>对战模式<select data-room="modeId" ${disabled}>${[["deathmatch", "自由交战"], ["control", "据点争夺"], ["turf", "双队涂地 · 4 分钟"]].map(([id, name]) => `<option value="${id}" ${room.settings.modeId === id ? "selected" : ""}>${name}</option>`).join("")}</select></label><label>场地<select data-room="mapId" ${disabled}>${Object.values(maps).map(map => `<option value="${map.id}" ${room.settings.mapId === map.id ? "selected" : ""}>${esc(map.name)}</option>`).join("")}</select></label><label class="check-label"><input type="checkbox" data-room="teamMode" ${room.settings.modeId !== "deathmatch" || room.settings.teamMode ? "checked" : ""} ${room.settings.modeId !== "deathmatch" ? "disabled" : disabled}> 分队对战</label><label>我的队伍<select id="team"><option value="blue" ${team === "blue" ? "selected" : ""}>蓝墨队</option><option value="red" ${team === "red" ? "selected" : ""}>朱墨队</option></select></label></div><div class="members">${room.members.map(member => `<span>${esc(member.name)} · ${esc(classes[member.classId].name)}<b>${member.connected ? member.ready ? "已准备" : "配装中" : "已断开"}</b></span>`).join("")}</div>${classCards(state)}<p class="muted" id="room-start-hint" role="status">${startHint}</p><footer class="actions">${btn("leave", "离开房间")}${btn("ready", "确认装备 · 准备")}${host ? btn("start-room", "开始对局 →", `class="primary" aria-describedby="room-start-hint" ${requirements.length ? "disabled" : ""}`) : '<span class="muted">等待房主开始</span>'}</footer>`);
}
function home(game: GameController) {
  const cp = game.store.load().checkpoint;
  return `<section class="home"><div class="eyebrow">纸上作战 · 第一册</div><h1>墨绘<span>战场</span></h1><div class="handwritten">Ink Battlefield</div><p class="intro">铅笔勾勒世界，彩墨留下你的笔迹。</p><nav aria-label="主要菜单">${btn("solo", '<span class="nav-index">01</span><span><strong>单机战役</strong><small>穿行三章画境，完成你的冒险</small></span><b>↗</b>', 'class="primary"')}${cp ? btn("continue-save", '<span class="nav-index">↳</span><span><strong>继续上次旅程</strong><small>从保存的检查点出发</small></span><b>→</b>') : ""}${btn("turf", '<span class="nav-index">02</span><span><strong>双队涂地</strong><small>蓝墨 vs 朱墨 · 4 分钟争夺整张地面</small></span><b>↗</b>', 'class="turf-entry"')}${btn("practice", '<span class="nav-index">03</span><span><strong>自由试笔</strong><small>挑一件画具，先试试手感</small></span><b>↗</b>')}${btn("network", '<span class="nav-index">04</span><span><strong>局域网对战</strong><small>与 2–8 位朋友同场落笔</small></span><b>↗</b>')}</nav><div class="home-links">${btn("settings", "画具设置")}${btn("records", "战绩档案")}</div><div class="home-note">4 种职业 <span>·</span> ${Object.keys(weapons).length} 件画具 <span>·</span> 全部开放</div></section><aside class="scene-note"><span>FIG. 01 — THE SKETCHBOOK</span><p>把胜负留在纸上。</p><small>移动 · 射击 · 给世界上一点颜色</small></aside>`;
}
function settings(game: GameController) {
  const x = game.store.load().settings;
  return panel("调好你的画具", "偏好设置", `<p class="muted">调整会立即保存，下次打开仍然生效。</p><div class="settings"><label>音量<input type="range" min="0" max="1" step="0.05" data-setting="volume" value="${x.volume}"></label><label>鼠标灵敏度<input type="range" min="0.2" max="3" step="0.1" data-setting="sensitivity" value="${x.sensitivity}"></label><label>画面质量<select data-setting="quality">${["low", "medium", "high"].map((id, i) => `<option value="${id}" ${x.quality === id ? "selected" : ""}>${["轻量", "均衡", "细腻"][i]}</option>`).join("")}</select></label><label>HUD 字号<select data-setting="hudScale"><option value="1" ${(x.hudScale ?? 1) === 1 ? "selected" : ""}>标准</option><option value="1.2" ${x.hudScale === 1.2 ? "selected" : ""}>较大 · 120%</option><option value="1.4" ${x.hudScale === 1.4 ? "selected" : ""}>大字 · 140%</option></select></label><label class="check-label"><input type="checkbox" data-setting="reduceMotion" ${x.reduceMotion ? "checked" : ""}> 减少镜头晃动与受伤闪边</label></div>${controls}<footer class="actions">${btn(game.session ? "resume" : "home", "保存并返回 →", 'class="primary"')}</footer>`);
}
function results(game: GameController, snapshot: GameSnapshot) {
  const self = snapshot.actors.find(actor => actor.id === game.session?.playerId);
  const owner = (id: string) => id === "blue" ? teamInk.blue.name : id === "red" ? teamInk.red.name : snapshot.actors.find(actor => actor.teamId === id)?.name ?? id;
  return panel(resultTitle(snapshot.phase, snapshot.winner, self?.teamId, game.competitive), "画页结算", `<p>${esc(snapshot.objective.title)} · ${snapshot.campaign ? `已完成 ${snapshot.campaign.completed} 场遭遇` : snapshot.winner ? `${esc(owner(snapshot.winner))} 获胜` : "平局"}</p>${snapshot.modeId === "turf" ? renderTurfScore(snapshot, self?.teamId, true) : ""}<div class="results">${Object.entries(snapshot.scores).map(([id, value]) => `<p>${esc(owner(id))}<strong>${value.toFixed(snapshot.modeId === "turf" ? 1 : 0)} ${snapshot.modeId === "turf" ? "% 覆盖" : "分"}</strong></p>`).join("")}${snapshot.actors.filter(actor => actor.kind === "player").map(actor => `<p>${esc(actor.name)}<strong>${actor.kills} 击败 / ${actor.deaths} 倒下</strong></p>`).join("")}</div><footer class="actions">${btn("inspect", "查看留下的笔迹")}${btn("capture", "保存战场留影", game.state.busy ? "disabled" : "")}${btn("capture-compare", "保存开局 / 结束对照", game.state.busy ? "disabled" : "")}${game.online ? btn("rematch", "再来一局") : stateTurfRestart(game)}${btn("leave", "回到扉页 →", 'class="primary"')}</footer>`);
}
export function renderMenu(game: GameController): string {
  const state = game.state, snapshot = game.session?.getSnapshot();
  if (state.screen === "network" && game.hostedPreview) return panel("和朋友，在同一张画纸上", "局域网玩法", `<p class="panel-description">网页版可体验单机战役、电脑双队涂地和自由试笔。局域网对战需要在主机电脑运行工程中的「启动局域网.cmd」，再让同一局域网的朋友打开主机显示的网址。</p><p class="muted">当前网页没有托管联机房间。局域网版本支持 2–8 人、三种竞技玩法。</p><footer class="actions">${btn("home", "← 返回扉页")}${btn("practice", "先试试画具 →", 'class="primary"')}</footer>`);
  if (state.screen === "settings") return settings(game);
  if (snapshot) {
    if (state.screen === "inspect") return `<div class="inspect"><span>战场观察 · WASD 移动 / Space 上升 / Ctrl 下降 / 拖动转向</span>${btn("capture", "保存留影", state.busy ? "disabled" : "")}${btn("capture-compare", "保存前后对照", state.busy ? "disabled" : "")}${btn("results", "返回结算")}</div>`;
    const player = snapshot.actors.find(actor => actor.id === game.session?.playerId);
    const overlay = overlayFor(snapshot.phase, player?.alive ?? false, game.competitive, state.menuOpen);
    if (overlay === "upgrade") return panel("下一笔，更有力量", "遭遇完成 / 补给与成长", `<p class="muted">选择一项成长，调整画具后继续前进。</p><div class="upgrade-grid">${(snapshot.campaign?.choices ?? []).map(id => btn("upgrade", `<small>成长选择</small><h3>${esc(upgrades[id]?.name ?? id)}</h3><p>${esc(upgrades[id]?.description)}</p>${upgradeHint(id, state)}`, `data-id="${id}" ${state.chosenUpgrade ? "disabled" : ""}`)).join("")}</div>${equipment(state)}<footer class="actions">${btn("next", "收好画具 · 继续 →", 'class="primary"')}</footer>`);
    if (overlay === "results") return results(game, snapshot);
    if (overlay === "respawn") return panel("换一种笔触，再出发", "重返战场 / 调整职业与装备", `<p class="muted">倒下 5 秒后自动返回战场；现在可以调整职业与画具。</p>${classCards(state)}<footer class="actions">${btn("leave", "离开对局")}${btn("respawn", "确认装备 · 重返战场 →", 'class="primary"')}</footer>`);
    if (overlay === "pause") return panel("稍歇一笔", "战场菜单", `<p>${game.online ? "联机对局仍在继续。" : "战场已暂停，准备好再继续。"}</p>${controls}<footer class="actions">${btn("leave", "返回扉页")}${btn("settings", "设置")}${stateTurfRestart(game)}${snapshot.modeId === "practice" ? btn("capture", "保存留影", state.busy ? "disabled" : "") + btn("capture-compare", "前后对照", state.busy ? "disabled" : "") : ""}${btn("resume", "继续作画 →", 'class="primary"')}</footer>`);
    return "";
  }
  switch (state.screen) {
    case "home": return home(game);
    case "class": if (state.mode === "turf") return turfSetup(game);
      return panel(state.mode === "practice" ? "自由试笔" : "选择你的落笔方式", state.mode === "practice" ? "练习画页 / 随时重新落笔" : "单机战役 / 出发准备", `<p class="panel-description">${state.mode === "practice" ? "静态目标采用对战伤害，击倒后 5 秒重生。按 P 暂停、留影或继续；Esc 返回换装并重置场地。试笔不写入战役档案。" : "四种职业，四种笔触。带上两件主武器与一件近战画具，翻开第一章。"}</p>${state.mode === "campaign" ? `<aside class="starter-note"><div><strong>第一次落笔？</strong><span>约两分钟，试试开火、换弹、换枪与钩索；也可以直接出发。</span></div>${btn("guided-practice", "先做上手试笔")}</aside>` : state.guidedPractice ? `<aside class="starter-note"><span>上手练习随时可跳过，已选职业与画具会保留。</span>${btn("guide-campaign", "返回战役配装")}</aside>` : ""}${classCards(state)}<footer class="actions">${btn("home", "← 返回扉页")}${btn("begin", state.busy ? "准备画页…" : state.mode === "practice" ? "开始试笔 →" : "翻开第一章 →", `class="primary" ${state.busy ? "disabled" : ""}`)}</footer>`);
    case "network": return panel(state.networkMode === "turf" ? "双队涂地 · 和朋友争夺地面" : "和朋友，画一场对决", "局域网 / 2–8 人同场", `<p class="muted">${state.networkMode === "turf" ? "4 分钟 · 蓝墨队 / 朱墨队 · 按地面覆盖率判胜。" : ""}运行局域网服务器后，输入地址创建或加入房间。</p><div class="fields"><label>你的昵称<input id="name" maxlength="20" autocomplete="nickname" value="${esc(state.name)}"></label><label>服务器地址<input id="address" spellcheck="false" value="${esc(state.address)}"></label><label>房间号<input id="code" placeholder="加入房间时填写" autocomplete="off" value="${esc(state.roomCode)}"></label></div><footer class="actions">${btn("home", "← 返回")}${btn("join", state.busy ? "连接中…" : "加入房间", state.busy ? "disabled" : "")}${btn("create", "创建房间 →", `class="primary" ${state.busy ? "disabled" : ""}`)}</footer>`);
    case "room": return game.room ? roomView(game.room, state, game.team.value, game.lobby?.playerId) : "";
    case "records": {
      const profile = game.store.load();
      return panel("你的画页档案", "旅途记录", `<div class="record-totals"><p><strong>${profile.stats.runs}</strong> 次出发</p><p><strong>${profile.stats.wins}</strong> 次三章通关</p><p><strong>${profile.stats.kills}</strong> 次击败</p></div><div class="results">${challenges(profile).map(item => `<p><span><b>${item.current >= item.target ? "✓" : "○"} ${esc(item.name)}</b><small>${esc(item.description)}</small></span><strong>${Math.min(item.current, item.target)} / ${item.target}</strong></p>`).join("")}</div><p class="muted">全部 ${Object.keys(weapons).length} 件画具已开放。职业遭遇记录：${Object.values(classes).map(role => `${role.name} ${profile.progress[role.id]}`).join(" · ")}</p><footer class="actions">${btn("home", "返回扉页 →", 'class="primary"')}</footer>`);
    }
    default: return "";
  }
}

function stateTurfRestart(game: GameController) {
  return game.state.mode === "turf" ? btn("turf-restart", "再涂一局", game.state.busy ? "disabled" : "") : "";
}
function turfSetup(game: GameController) {
  const state = game.state;
  return panel("把地面，涂成你的主场", "双队涂地 / 2 对 2 · 4 分钟", `<div class="turf-brief" style="--turf-blue:${teamInk.blue.css};--turf-red:${teamInk.red.css}"><div class="turf-team blue"><b>${teamInk.blue.name}</b><span>你 + 1 位电脑队友</span></div><strong>VS</strong><div class="turf-team red"><b>${teamInk.red.name}</b><span>2 位电脑对手</span></div></div><p class="panel-description">用自己的墨色覆盖地面，也能盖掉对方墨迹。时间结束，地面覆盖率更高的一队获胜；墙面与击败数不计入占比，平局也会如实结算。</p><div class="turf-options"><label>这次涂哪一页<select id="turf-map">${Object.values(maps).map(map => `<option value="${map.id}" ${map.id === (state.turfMap ?? "construction") ? "selected" : ""}>${esc(map.name)}</option>`).join("")}</select></label><p>推荐先用毛笔或滚筒，边移动边朝地面涂墨。<br>按 Esc / P 暂停；倒下 5 秒自动返回。</p></div>${classCards(state)}<footer class="actions">${btn("home", "← 返回扉页")}${btn("turf-network", "和朋友局域网对战")}${btn("begin", state.busy ? "准备画页…" : "开始涂地 →", `class="primary" ${state.busy ? "disabled" : ""}`)}</footer>`);
}
