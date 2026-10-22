import type { Profile, ClassId, Checkpoint } from "../shared/contracts";
import { classes, weapons, upgrades, getLoadout } from "../content";
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export const PROFILE_KEY = "ink-battlefield.profile.v1";
export function emptyProfile(): Profile {
  return {
    version: 1,
    name: "画页旅人",
    settings: {
      sensitivity: 1,
      volume: 0.5,
      quality: "medium",
      reduceMotion: false,
      hudScale: 1,
    },
    progress: { assault: 0, heavy: 0, scout: 0, artist: 0 },
    stats: { runs: 0, wins: 0, kills: 0 },
    checkpoint: null,
  };
}
const memory = (): StorageLike => {
  const values = new Map<string, string>();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
    removeItem: (k) => {
      values.delete(k);
    },
  };
};
function count(n: unknown) {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.floor(n))
    : 0;
}
export class ProfileStore {
  readonly storage: StorageLike;
  recoveryNotice = "";
  private cached: Profile | null = null;
  private currentSettings: Readonly<Profile["settings"]> | null = null;
  private notices = new Set<(message: string) => void>();
  private unsaved = false;
  private pendingBackup: string | null = null;
  private baseline: Profile = emptyProfile();
  constructor(storage?: StorageLike) {
    this.storage =
      storage ??
      (typeof localStorage !== "undefined" ? localStorage : memory());
  }
  onSaveNotice(listener: (message: string) => void) {
    this.notices.add(listener);
    return () => this.notices.delete(listener);
  }
  get settings(): Readonly<Profile["settings"]> {
    if (!this.currentSettings) this.load();
    return this.currentSettings!;
  }
  private remember(profile: Profile): Profile {
    this.cached = structuredClone(profile);
    this.currentSettings = Object.freeze({ ...profile.settings });
    return structuredClone(profile);
  }
  refresh(): Profile {
    if (!this.unsaved) { this.cached = null; this.currentSettings = null; }
    return this.load();
  }
  load(): Profile {
    if (this.cached) return structuredClone(this.cached);
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(PROFILE_KEY);
      if (!raw) { this.baseline = emptyProfile(); return this.remember(this.baseline); }
      const p = this.decode(raw);
      this.baseline = structuredClone(p);
      return this.remember(p);
    } catch {
      this.recoveryNotice = "存档无法读取，本次先使用临时档案。";
      if (raw) {
        this.baseline = emptyProfile();
        try {
          this.storage.setItem("ink-battlefield.profile.backup", raw);
          this.storage.removeItem(PROFILE_KEY);
          this.recoveryNotice = "存档无法读取，已保留恢复副本并建立新档案。";
        } catch {
          this.pendingBackup = raw;
          this.unsaved = true;
          this.recoveryNotice = "存档无法读取且恢复备份失败；原档案保留，本次先使用临时档案。";
        }
      }
      return this.remember(this.baseline);
    }
  }
  private decode(raw: string): Profile {
    const parsed = JSON.parse(raw);
    if (
      parsed.version !== 1 ||
      !parsed.settings ||
      !parsed.progress ||
      !parsed.stats
    )
      throw new Error("unsupported profile");
    const p = emptyProfile();
    p.name = String(parsed.name ?? p.name).slice(0, 20);
    for (const id of Object.keys(classes) as ClassId[])
      p.progress[id] = count(parsed.progress[id]);
    for (const k of ["runs", "wins", "kills"] as const)
      p.stats[k] = count(parsed.stats[k]);
    const s = parsed.settings;
    p.settings = {
      sensitivity: Math.max(0.2, Math.min(3, Number(s.sensitivity) || 1)),
      volume: Math.max(
        0,
        Math.min(1, Number.isFinite(s.volume) ? s.volume : 0.5),
      ),
      quality: ["low", "medium", "high"].includes(s.quality)
        ? s.quality
        : "medium",
      reduceMotion: s.reduceMotion === true,
      hudScale: Math.max(1, Math.min(1.4, Number(s.hudScale) || 1)),
    };
    const cp = parsed.checkpoint;
    if (
      cp &&
      classes[cp.classId as ClassId] &&
      Number.isInteger(cp.seed) &&
      Number.isInteger(cp.completed) &&
      cp.completed >= 0 &&
      cp.completed < 9 &&
      Array.isArray(cp.upgrades) &&
      Array.isArray(cp.weapons)
    ) {
      p.checkpoint = {
        classId: cp.classId,
        seed: cp.seed,
        completed: cp.completed,
        totalKills: count(cp.totalKills),
        upgrades: cp.upgrades
          .filter(
            (id: string) =>
              upgrades[id] &&
              (upgrades[id].classId === "all" ||
                upgrades[id].classId === cp.classId),
          )
          .slice(0, 30),
        weapons: getLoadout(
          cp.classId,
          cp.weapons,
          this.unlockedWeapons(cp.classId),
        ),
      };
    }
    return p;
  }
  save(profile: Profile) {
    if (!this.cached) this.load();
    const next = structuredClone(profile);
    if (next.checkpoint) next.checkpoint.totalKills = count(next.checkpoint.totalKills);
    this.remember(next);
    const wasUnsaved = this.unsaved;
    try {
      // Read before any write: a failed read cannot justify replacing unknown progress.
      const raw = this.storage.getItem(PROFILE_KEY);
      let latest = emptyProfile();
      if (raw) {
        try { latest = this.decode(raw); }
        catch { this.storage.setItem("ink-battlefield.profile.backup", raw); }
      }
      if (this.pendingBackup !== null) {
        this.storage.setItem("ink-battlefield.profile.backup", this.pendingBackup);
        this.pendingBackup = null;
      }
      const sameCheckpoint = (a: Profile["checkpoint"], b: Profile["checkpoint"]) => JSON.stringify(a) === JSON.stringify(b);
      const localCheckpointChanged = !sameCheckpoint(next.checkpoint, this.baseline.checkpoint);
      let conflictKey = "";
      if (raw && localCheckpointChanged && !sameCheckpoint(latest.checkpoint, this.baseline.checkpoint)
        && !sameCheckpoint(latest.checkpoint, next.checkpoint)) {
        conflictKey = `ink-battlefield.profile.conflict.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this.storage.setItem(conflictKey, raw);
      }
      const merged = structuredClone(latest);
      if (next.name !== this.baseline.name) merged.name = next.name;
      for (const key of Object.keys(next.settings) as (keyof Profile["settings"])[]) {
        if (next.settings[key] !== this.baseline.settings[key]) Object.assign(merged.settings, { [key]: next.settings[key] });
      }
      for (const key of Object.keys(next.stats) as (keyof Profile["stats"])[])
        merged.stats[key] += Math.max(0, count(next.stats[key]) - count(this.baseline.stats[key]));
      for (const key of Object.keys(next.progress) as ClassId[])
        merged.progress[key] += Math.max(0, count(next.progress[key]) - count(this.baseline.progress[key]));
      if (localCheckpointChanged) merged.checkpoint = next.checkpoint;
      this.storage.setItem(PROFILE_KEY, JSON.stringify(merged));
      this.baseline = structuredClone(merged);
      this.remember(merged);
      this.unsaved = false;
      this.recoveryNotice = "";
      if (conflictKey) for (const listener of this.notices)
        listener(`检查点发生冲突，已保留当前页面进度；另一窗口的档案已备份至 ${conflictKey}。`);
      else if (wasUnsaved) for (const listener of this.notices) listener("保存已恢复，本次进度已写入浏览器。");
      return true;
    } catch {
      this.recoveryNotice = "浏览器存储不可用，本次进度未能保存；当前页面可继续，关闭前请重试保存。";
      this.unsaved = true;
      if (!wasUnsaved) for (const listener of this.notices) listener(this.recoveryNotice);
      return false;
    }
  }
  get hasUnsavedChanges() { return this.unsaved; }
  retrySave() { return this.save(this.load()); }
  unlockedWeapons(c: ClassId) {
    // Playtest build: unlock equipment independently of earned statistics.
    // Existing saves therefore gain access without inventing completed encounters.
    const def = classes[c];
    return [...def.weapons, def.melee];
  }
  updateSettings(settings: Partial<Profile["settings"]>) {
    const p = this.refresh();
    Object.assign(p.settings, settings);
    this.save(p);
  }
  clearCheckpoint() {
    const p = this.refresh();
    p.checkpoint = null;
    this.save(p);
  }
  checkpoint(cp: Checkpoint) {
    const p = this.refresh();
    p.checkpoint = cp;
    this.save(p);
  }
  recordEncounter(c: ClassId) {
    const p = this.refresh();
    p.progress[c]++;
    this.save(p);
  }
  recordRun(won: boolean, kills: number) {
    const p = this.refresh();
    p.stats.runs++;
    p.stats.wins += Number(won);
    p.stats.kills += kills;
    p.checkpoint = null;
    this.save(p);
  }
}
