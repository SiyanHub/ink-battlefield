import { classes, weapons } from "../../content";
import type { UiState } from "./controller";
export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export const button = (action: string, text: string, attrs = "") => `<button type="button" data-action="${action}" ${attrs}>${text}</button>`;
export const panel = (title: string, subtitle: string, body: string) => `<section class="panel"><header class="panel-heading"><span class="eyebrow">${subtitle}</span><h2>${title}</h2></header>${body}</section>`;
export const controls = `<div class="control-guide"><span><kbd>W A S D</kbd> 移动</span><span><kbd>Shift</kbd> 冲刺</span><span><kbd>Space</kbd> 跳跃</span><span><kbd>左键</kbd> 射击 / 蓄力</span><span><kbd>右键</kbd> 瞄准 / 格挡</span><span><kbd>R</kbd> 换弹</span><span><kbd>1 2 3</kbd> 换武器</span><span><kbd>E</kbd> 职业技能</span><span><kbd>Q</kbd> 钩索</span></div>`;
export function equipment(state: UiState) {
  const role = classes[state.selected];
  const mode = state.mode === "campaign" ? "单机" : "对战";
  const rack = `<div class="weapon-rack" aria-label="主武器速选">${role.weapons.map(id => {
    const item = weapons[id], selected = state.loadout[0] === id;
    const type = item.splash ? "范围墨爆" : item.charge ? "蓄力弹体" : item.behavior === "beam" ? "贯穿墨弹" : item.model === "dual" ? "双枪齐射" : item.pellets ? "散射墨弹" : item.burst ? "三发点射" : item.automatic ? "连续射击" : "精准单发";
    return `<button type="button" data-action="equip-primary" data-id="${id}" aria-pressed="${selected}" class="${selected ? "selected" : ""}"><strong>${esc(item.name)}</strong><span>${type} · ${item.capacity} 发</span></button>`;
  }).join("")}</div>`;
  return `<section class="equipment"><div class="equipment-note"><span class="eyebrow">02 / 配置画具</span><small>${mode}基础数值 · 不含成长、弱点与距离修正</small></div>${rack}${[0, 1].map(slot => {
    const weapon = weapons[state.loadout[slot]];
    const firing = weapon?.charge ? `蓄力 · 按住左键，松开释放（${weapon.charge} 秒满蓄）` : weapon?.automatic ? "全自动 · 按住左键" : weapon?.burst ? "半自动 · 点按左键，三发点射" : "半自动 · 点按左键";
    return `<div class="weapon-detail"><label><span>${slot + 1} / ${slot === 0 ? "主武器" : "备用武器"}</span><select data-slot="${slot}" aria-label="${slot === 0 ? "主武器" : "备用武器"}">${slot === 1 ? `<option value="" ${!state.loadout[slot] ? "selected" : ""}>留空</option>` : ""}${role.weapons.map(id => `<option value="${id}" ${state.loadout[slot] === id ? "selected" : ""}>${esc(weapons[id].name)}</option>`).join("")}</select></label>${weapon ? `<p>${esc(weapon.description)}</p><small class="firing-guide">${firing}</small><div class="weapon-stats"><span>${state.mode === "campaign" ? weapon.damage : weapon.pvpDamage} 点 / ${weapon.pellets ? "每弹丸" : "每发"}${weapon.charge ? "（满蓄）" : ""}</span><span>${weapon.capacity} 发弹匣</span><span>${weapon.reload} 秒换弹</span><span>${weapon.range} 米射程</span></div>` : '<p class="empty-slot">留一个空位，滚轮会直接切换到近战画具。</p>'}</div>`;
  }).join("")}<div class="equipment-footer"><span><kbd>3</kbd> ${esc(weapons[role.melee].name)} · 近战 · ${weapons[role.melee].automatic ? "按住" : "点按"}左键</span><span><kbd>E</kbd> ${esc(role.skillName)}：${esc(role.skillDescription)}</span></div></section>`;
}
const drawings: Record<string, string> = {
  assault: 'M15 32 L50 18 L74 23 L74 29 L47 34 L36 43 L27 40 L33 34 M47 22 L67 26 M22 28 L22 36',
  heavy: 'M20 18 L58 18 L68 29 L68 42 L58 50 L20 50 Z M28 23 L52 23 L60 31 L60 39 L52 44 L28 44 Z M38 20 L38 48',
  scout: 'M20 16 Q67 32 20 51 M20 16 L34 33 L20 51 M19 33 L74 33 M67 27 L74 33 L67 39',
  artist: 'M24 44 L49 20 L55 26 L30 50 Z M49 20 Q53 7 65 13 Q70 27 55 26 M20 53 L34 53 M57 36 Q72 44 65 51',
};
export function classCards(state: UiState, withEquipment = true) {
  return `<div class="section-label"><span>01 / 选择职业</span><small>当前职业可选 ${classes[state.selected].weapons.length} 件主武器与一件近战画具</small></div><div class="class-grid">${Object.values(classes).map((role, index) => `<button type="button" class="class-card ${state.selected === role.id ? "selected" : ""}" data-action="class" data-id="${role.id}" aria-pressed="${state.selected === role.id}"><div class="class-card-top"><span>0${index + 1}</span><span class="selection-mark">${state.selected === role.id ? "已选" : "选择"}</span></div><svg viewBox="0 0 90 65" aria-hidden="true"><path d="${drawings[role.id]}" /></svg><strong>${esc(role.name)}</strong><small>${esc(role.subtitle)}</small><p>${esc(role.description)}</p><span class="skill-label"><kbd>E</kbd> ${esc(role.skillName)}</span></button>`).join("")}</div>${withEquipment ? equipment(state) : ""}`;
}
