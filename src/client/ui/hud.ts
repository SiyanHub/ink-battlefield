import { classes, enemies, maps, upgrades, weapons } from "../../content";
import type { GameSnapshot } from "../../shared/contracts";
import { floorOwnership } from "../presenter";
import type { QuickStartView } from "./quick-start";
import { renderTurfScore } from "./turf-score";
import { teamInk } from "../../shared/ink";
import { esc } from "./components";
import type { BattleFeedbackView } from "./feedback";
function ownerLabel(owner: string | null, snapshot: GameSnapshot) {
  if (owner === "blue" || owner === "red") return teamInk[owner].name;
  if (owner === "player") return "你的笔迹";
  if (owner === "enemy") return "纸兵";
  return owner ? snapshot.actors.find(actor => actor.teamId === owner)?.name ?? owner : "尚未染色";
}
/** A compact battle-only view; full instructions belong in equipment and pause pages. */
export function renderHud(snapshot: GameSnapshot, playerId: string, showScores: boolean, feedback?: BattleFeedbackView, guide?: QuickStartView): string {
  const player = snapshot.actors.find(actor => actor.id === playerId);
  if (!player) return "";
  const weapon = weapons[player.weaponId], ammo = player.ammo[player.weaponId];
  const cooldown = (until: number) => Math.max(0, Math.ceil(until - snapshot.time));
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const reloadRemaining = Math.max(0, (ammo?.reloadUntil ?? 0) - snapshot.time);
  const reloadStart = feedback?.reload?.weaponId === player.weaponId && feedback.reload.until === ammo?.reloadUntil ? feedback.reload.start : (ammo?.reloadUntil ?? 0) - (weapon?.reload ?? 1);
  const reloadProgress = clamp(1 - reloadRemaining / Math.max(.001, (ammo?.reloadUntil ?? 0) - reloadStart));
  const quickcharge = player.upgrades.reduce((total, id) => total + (upgrades[id]?.effect === "quickcharge" ? upgrades[id].amount : 0), 0);
  const charging = !!weapon?.charge && ammo?.chargeStarted !== null && ammo?.chargeStarted !== undefined && !reloadRemaining;
  const chargeProgress = charging ? clamp((snapshot.time - ammo.chargeStarted!) / (weapon.charge! * Math.max(.3, 1 - quickcharge))) : 0;
  const bosses = snapshot.actors.filter(actor => actor.alive && actor.kind === "enemy" && enemies[actor.enemyId ?? ""]?.boss).slice(0, 2);
  const lowHealth = player.alive && player.hp <= player.maxHp * .3;
  const turf = snapshot.modeId === "turf";
  const practice = snapshot.modeId === "practice";
  const mode = practice ? "自由试笔" : snapshot.campaign ? `第 ${snapshot.campaign.chapter + 1} 章` : "联机对战";
  const available = player.weapons.flatMap((id, slot) => id ? [`<span class="${id === player.weaponId ? "equipped" : ""}"><kbd>${slot + 1}</kbd>${esc(weapons[id]?.name)}</span>`] : []);
  const next = guide?.steps.find(step => !step.done);
  const guidance = guide ? `<section class="quick-start"><small>上手试笔 · 顺序不限 · 随时可跳过</small><h3>${guide.complete ? "准备好了，翻开第一章" : esc(next?.title)}</h3><p>${guide.complete ? "五项操作已完成。继续练习，或返回配装开始战役。" : esc(next?.hint)}</p><div>${guide.steps.map(step => `<span class="${step.done ? "done" : ""}">${step.done ? "✓" : "○"} ${esc(step.title)}</span>`).join("")}</div></section>` : "";
  return `${guidance}<div class="scope-view" role="img" aria-label="狙击镜"><div class="scope-lens"><i></i><b></b><span>松开右键退出</span></div></div>${feedback?.hurt && !feedback.reduceMotion ? '<div class="damage-edge" aria-hidden="true"></div>' : ""}${turf ? renderTurfScore(snapshot, player.teamId) : `<section class="mission"><small>${mode} <span>/</span> ${esc(maps[snapshot.mapId]?.name)}</small><h3>${esc(snapshot.objective.title)}</h3><p>${esc(snapshot.objective.description)}</p><div class="objective-progress"><progress aria-label="任务进度" max="${snapshot.objective.target || 1}" value="${snapshot.objective.progress}"></progress><span>${Math.floor(snapshot.objective.progress)} / ${snapshot.objective.target}${snapshot.remaining > 0 ? ` · ${Math.ceil(snapshot.remaining)}s` : ""}</span></div>${snapshot.objective.deviceHp !== undefined ? `<p>画心 ${Math.ceil(snapshot.objective.deviceHp)} / 500</p><progress aria-label="画心生命" max="500" value="${snapshot.objective.deviceHp}"></progress>` : ""}</section>`}${bosses.length ? `<section class="boss-health">${bosses.map(boss => `<div><span>${esc(boss.name)}</span><small>${Math.ceil(boss.hp)} / ${boss.maxHp}</small><progress aria-label="${esc(boss.name)}生命" max="${boss.maxHp}" value="${boss.hp}"></progress></div>`).join("")}</section>` : ""}<div class="crosshair ${feedback?.lethal ? "lethal" : feedback?.hit ? "confirmed" : ""}" aria-hidden="true"><i></i></div>${feedback?.damage ? `<span class="hit-confirmation ${feedback.damageLethal ? "lethal" : ""}">${feedback.damage}<small>${feedback.damageLethal ? "击倒" : "命中"}</small></span>` : feedback?.hit ? '<span class="hit-confirmation">命中</span>' : ""}${feedback?.kills.length ? `<div class="kill-confirmations">${feedback.kills.map(name => `<p>击倒 · ${esc(name)}</p>`).join("")}</div>` : ""}<section class="health ${lowHealth ? "low-health" : ""}"><span class="hud-caption">${esc(classes[player.classId].name)} / 生命</span><div><strong>${Math.ceil(player.hp)}</strong><small> / ${player.maxHp}</small></div>${lowHealth ? '<span class="health-warning">生命偏低 · 寻找掩护</span>' : feedback?.hurt ? '<span class="health-warning">受到伤害</span>' : ""}<progress aria-label="生命" max="${player.maxHp}" value="${player.hp}"></progress></section><section class="ammo"><span class="hud-caption">${esc(weapon?.name ?? player.weaponId)}</span><div><strong>${ammo && ammo.reloadUntil > snapshot.time ? "换弹中" : weapon?.melee ? "∞" : ammo?.clip ?? 0}</strong><small>${weapon?.melee ? " / 近战" : ` / ${ammo?.reserve ?? "—"}`}</small></div>${reloadRemaining ? `<div class="weapon-progress"><span>换弹 · ${reloadRemaining.toFixed(1)}s</span><progress aria-label="换弹进度" max="1" value="${reloadProgress.toFixed(3)}"></progress></div>` : charging ? `<div class="weapon-progress"><span>${chargeProgress >= 1 ? "满蓄" : `蓄力 ${Math.round(chargeProgress * 100)}%`} · 松开射击</span><progress aria-label="蓄力进度" max="1" value="${chargeProgress.toFixed(3)}"></progress></div>` : ""}<span class="ammo-hint">${weapon?.melee ? "左键攻击 · 滚轮切换" : "按住右键瞄准 · R 换弹"}</span></section><div class="abilities"><span><kbd>E</kbd> ${esc(classes[player.classId].skillName)} <b>${cooldown(player.skillCooldown) || "就绪"}</b></span><span><kbd>Q</kbd> 钩索 <b>${cooldown(player.grappleCooldown) || "就绪"}</b></span></div><div class="weapon-strip">${available.join("")}</div><div class="controls">${practice ? "P 暂停 / 留影 · Esc 换装" : "Esc 菜单"} <span>·</span> Tab 战况与操作</div>${showScores ? `<section class="scoreboard"><h3>${practice ? "试笔手记" : "战场记录"}</h3><p>脚下地板 <b>${esc(ownerLabel(floorOwnership(maps[snapshot.mapId], snapshot.paint, player.pos), snapshot))}</b></p>${Object.entries(snapshot.scores).map(([id, score]) => `<p>${esc(ownerLabel(id, snapshot))}<b>${Math.round(score)}</b></p>`).join("")}${snapshot.actors.filter(actor => actor.kind === "player").sort((a, b) => b.kills - a.kills).map(actor => `<p>${esc(actor.name)}<b>${actor.kills} 击败 / ${actor.deaths} 倒下</b></p>`).join("")}<div class="score-controls">WASD 移动 · Shift 冲刺 · Space 跳跃<br>左键射击 / 蓄力 · 右键瞄准 / 格挡<br>E 职业技能 · Q 钩索 · R 换弹</div></section>` : ""}`;
}

export function renderPracticeTools(guided: boolean) {
  return `<button data-action="practice-pause">P 暂停</button><button data-action="capture">保存留影</button><button data-action="capture-compare">前后对照</button>${guided ? '<button data-action="guide-campaign">返回战役配装 →</button>' : ""}`;
}
