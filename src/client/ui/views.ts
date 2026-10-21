import { challenges } from "../../profile/challenges";
import { classes, maps, upgrades } from "../../content";
import type { GameSnapshot, RoomSnapshot } from "../../shared/contracts";
import { overlayFor, resultTitle } from "../presenter";
import type { GameController, UiState } from "./controller";
import { button as btn, classCards, controls, equipment, esc, panel } from "./components";

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
  )) requirements.push("蓝队与红队各至少 1 人");
  const startHint = requirements.length ? `开局条件：${requirements.join("；")}。` : "所有玩家已准备，可以开始对局。";
  return panel(`房间 ${esc(room.code)}`, "联机画室 / 等待落笔", `<div class="room-options"><label>对战模式<select data-room="modeId" ${disabled}>${[["deathmatch", "自由交战"], ["control", "据点争夺"], ["turf", "涂色占领"]].map(([id, name]) => `<option value="${id}" ${room.settings.modeId === id ? "selected" : ""}>${name}</option>`).join("")}</select></label><label>场地<select data-room="mapId" ${disabled}>${Object.values(maps).map(map => `<option value="${map.id}" ${room.settings.mapId === map.id ? "selected" : ""}>${esc(map.name)}</option>`).join("")}</select></label><label class="check-label"><input type="checkbox" data-room="teamMode" ${room.settings.modeId !== "deathmatch" || room.settings.teamMode ? "checked" : ""} ${room.settings.modeId !== "deathmatch" ? "disabled" : disabled}> 分队对战</label><label>我的队伍<select id="team"><option value="blue" ${team === "blue" ? "selected" : ""}>蓝队</option><option value="red" ${team === "red" ? "selected" : ""}>红队</option></select></label></div><div class="members">${room.members.map(member => `<span>${esc(member.name)} · ${esc(classes[member.classId].name)}<b>${member.connected ? member.ready ? "已准备" : "配装中" : "已断开"}</b></span>`).join("")}</div>${classCards(state)}<p class="muted" id="room-start-hint" role="status">${startHint}</p><footer class="actions">${btn("leave", "离开房间")}${btn("ready", "确认装备 · 准备")}${host ? btn("start-room", "开始对局 →", `class="primary" aria-describedby="room-start-hint" ${requirements.length ? "disabled" : ""}`) : '<span class="muted">等待房主开始</span>'}</footer>`);
}
function home(game: GameController) {
  const cp = game.store.load().checkpoint;
  return `<section class="home"><div class="eyebrow">纸上作战 · 第一册</div><h1>墨绘<span>战场</span></h1><div class="handwritten">Ink Battlefield</div><p class="intro">铅笔勾勒世界，彩墨留下你的笔迹。</p><nav aria-label="主要菜单">${btn("solo", '<span class="nav-index">01</span><span><strong>单机战役</strong><small>穿行三章画境，完成你的冒险</small></span><b>↗</b>', 'class="primary"')}${cp ? btn("continue-save", '<span class="nav-index">↳</span><span><strong>继续上次旅程</strong><small>从保存的检查点出发</small></span><b>→</b>') : ""}${btn("practice", '<span class="nav-index">02</span><span><strong>自由试笔</strong><small>挑一件画具，先试试手感</small></span><b>↗</b>')}${btn("network", '<span class="nav-index">03</span><span><strong>局域网对战</strong><small>与 2–8 位朋友同场落笔</small></span><b>↗</b>')}</nav><div class="home-links">${btn("settings", "画具设置")}${btn("records", "战绩档案")}</div><div class="home-note">4 种职业 <span>·</span> 16 件画具 <span>·</span> 全部开放</div></section><aside class="scene-note"><span>FIG. 01 — THE SKETCHBOOK</span><p>把胜负留在纸上。</p><small>移动 · 射击 · 给世界上一点颜色</small></aside>`;
}
function settings(game: GameController) {
  const x = game.store.load().settings;
  return panel("调好你的画具", "偏好设置", `<p class="muted">调整会立即保存，下次打开仍然生效。</p><div class="settings"><label>音量<input type="range" min="0" max="1" step="0.05" data-setting="volume" value="${x.volume}"></label><label>鼠标灵敏度<input type="range" min="0.2" max="3" step="0.1" data-setting="sensitivity" value="${x.sensitivity}"></label><label>画面质量<select data-setting="quality">${["low", "medium", "high"].map((id, i) => `<option value="${id}" ${x.quality === id ? "selected" : ""}>${["轻量", "均衡", "细腻"][i]}</option>`).join("")}</select></label><label class="check-label"><input type="checkbox" data-setting="reduceMotion" ${x.reduceMotion ? "checked" : ""}> 减少镜头晃动与受伤闪边</label></div>${controls}<footer class="actions">${btn(game.session ? "resume" : "home", "保存并返回 →", 'class="primary"')}</footer>`);
}
function results(game: GameController, snapshot: GameSnapshot) {
  const self = snapshot.actors.find(actor => actor.id === game.session?.playerId);
  const owner = (id: string) => id === "blue" ? "蓝队" : id === "red" ? "红队" : snapshot.actors.find(actor => actor.teamId === id)?.name ?? id;
  return panel(resultTitle(snapshot.phase, snapshot.winner, self?.teamId, game.online), "画页结算", `<p>${esc(snapshot.objective.title)} · ${snapshot.campaign ? `已完成 ${snapshot.campaign.completed} 场遭遇` : snapshot.winner ? `${esc(owner(snapshot.winner))} 获胜` : "平局"}</p><div class="results">${Object.entries(snapshot.scores).map(([id, value]) => `<p>${esc(owner(id))}<strong>${value.toFixed(snapshot.modeId === "turf" ? 1 : 0)} ${snapshot.modeId === "turf" ? "% 覆盖" : "分"}</strong></p>`).join("")}${snapshot.actors.filter(actor => actor.kind === "player").map(actor => `<p>${esc(actor.name)}<strong>${actor.kills} 击败 / ${actor.deaths} 倒下</strong></p>`).join("")}</div><footer class="actions">${btn("inspect", "查看留下的笔迹")}${game.online ? btn("rematch", "再来一局") : ""}${btn("leave", "回到扉页 →", 'class="primary"')}</footer>`);
}
export function renderMenu(game: GameController): string {
  const state = game.state, snapshot = game.session?.getSnapshot();
  if (state.screen === "network" && game.hostedPreview) return panel("和朋友，在同一张画纸上", "局域网玩法", `<p class="panel-description">网页版可体验单机战役和自由试笔。局域网对战需要在主机电脑运行工程中的「启动局域网.cmd」，再让同一局域网的朋友打开主机显示的网址。</p><p class="muted">当前网页没有托管联机房间。局域网版本支持 2–8 人、三种竞技玩法。</p><footer class="actions">${btn("home", "← 返回扉页")}${btn("practice", "先试试画具 →", 'class="primary"')}</footer>`);
  if (state.screen === "settings") return settings(game);
  if (snapshot) {
    if (state.screen === "inspect") return `<div class="inspect"><span>战场观察 · WASD 移动 / Space 上升 / Ctrl 下降 / 拖动转向</span>${btn("results", "返回结算")}</div>`;
    const player = snapshot.actors.find(actor => actor.id === game.session?.playerId);
    const overlay = overlayFor(snapshot.phase, player?.alive ?? false, game.online, state.menuOpen);
    if (overlay === "upgrade") return panel("下一笔，更有力量", "遭遇完成 / 补给与成长", `<p class="muted">选择一项成长，调整画具后继续前进。</p><div class="upgrade-grid">${(snapshot.campaign?.choices ?? []).map(id => btn("upgrade", `<small>成长选择</small><h3>${esc(upgrades[id]?.name ?? id)}</h3><p>${esc(upgrades[id]?.description)}</p>`, `data-id="${id}" ${state.chosenUpgrade ? "disabled" : ""}`)).join("")}</div>${equipment(state)}<footer class="actions">${btn("next", "收好画具 · 继续 →", 'class="primary"')}</footer>`);
    if (overlay === "results") return results(game, snapshot);
    if (overlay === "respawn") return panel("换一种笔触，再出发", "重返战场 / 调整职业与装备", `${classCards(state)}<footer class="actions">${btn("respawn", "确认装备 · 重返战场 →", 'class="primary"')}</footer>`);
    if (overlay === "pause") return panel("稍歇一笔", "战场菜单", `<p>${game.online ? "联机对局仍在继续。" : "战场已暂停，准备好再继续。"}</p>${controls}<footer class="actions">${btn("leave", "返回扉页")}${btn("settings", "设置")}${btn("resume", "继续作画 →", 'class="primary"')}</footer>`);
    return "";
  }
  switch (state.screen) {
    case "home": return home(game);
    case "class": return panel(state.mode === "practice" ? "自由试笔" : "选择你的落笔方式", state.mode === "practice" ? "练习画页 / 随时重新落笔" : "单机战役 / 出发准备", `<p class="panel-description">${state.mode === "practice" ? "静态目标采用对战伤害，击倒后 5 秒重生。按 Esc 返回换装，并重置当前场地。试笔不写入战役档案。" : "四种职业，四种笔触。带上两件主武器与一件近战画具，翻开第一章。"}</p>${classCards(state)}<footer class="actions">${btn("home", "← 返回扉页")}${btn("begin", state.busy ? "准备画页…" : state.mode === "practice" ? "开始试笔 →" : "翻开第一章 →", `class="primary" ${state.busy ? "disabled" : ""}`)}</footer>`);
    case "network": return panel("和朋友，画一场对决", "局域网 / 2–8 人同场", `<p class="muted">运行局域网服务器后，输入地址创建或加入房间。</p><div class="fields"><label>你的昵称<input id="name" maxlength="20" autocomplete="nickname" value="${esc(state.name)}"></label><label>服务器地址<input id="address" spellcheck="false" value="${esc(state.address)}"></label><label>房间号<input id="code" placeholder="加入房间时填写" autocomplete="off" value="${esc(state.roomCode)}"></label></div><footer class="actions">${btn("home", "← 返回")}${btn("join", state.busy ? "连接中…" : "加入房间", state.busy ? "disabled" : "")}${btn("create", "创建房间 →", `class="primary" ${state.busy ? "disabled" : ""}`)}</footer>`);
    case "room": return game.room ? roomView(game.room, state, game.team.value, game.lobby?.playerId) : "";
    case "records": {
      const profile = game.store.load();
      return panel("你的画页档案", "旅途记录", `<div class="record-totals"><p><strong>${profile.stats.runs}</strong> 次出发</p><p><strong>${profile.stats.wins}</strong> 次三章通关</p><p><strong>${profile.stats.kills}</strong> 次击败</p></div><div class="results">${challenges(profile).map(item => `<p><span><b>${item.current >= item.target ? "✓" : "○"} ${esc(item.name)}</b><small>${esc(item.description)}</small></span><strong>${Math.min(item.current, item.target)} / ${item.target}</strong></p>`).join("")}</div><p class="muted">全部 16 件画具已开放。职业遭遇记录：${Object.values(classes).map(role => `${role.name} ${profile.progress[role.id]}`).join(" · ")}</p><footer class="actions">${btn("home", "返回扉页 →", 'class="primary"')}</footer>`);
    }
    default: return "";
  }
}
