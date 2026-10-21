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
  constructor(storage?: StorageLike) {
    this.storage =
      storage ??
      (typeof localStorage !== "undefined" ? localStorage : memory());
  }
  load(): Profile {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(PROFILE_KEY);
      if (!raw) return emptyProfile();
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
    } catch {
      this.recoveryNotice = "存档无法读取，已保留恢复副本并建立新档案。";
      if (raw) {
        try {
          this.storage.setItem("ink-battlefield.profile.backup", raw);
          this.storage.removeItem(PROFILE_KEY);
        } catch {}
      }
      return emptyProfile();
    }
  }
  save(profile: Profile) {
    try {
      this.storage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      this.recoveryNotice = "浏览器存储空间不可用，本次进度未能写入。";
    }
  }
  unlockedWeapons(c: ClassId) {
    // Playtest build: unlock equipment independently of earned statistics.
    // Existing saves therefore gain access without inventing completed encounters.
    const def = classes[c];
    return [...def.weapons, def.melee];
  }
  updateSettings(settings: Partial<Profile["settings"]>) {
    const p = this.load();
    Object.assign(p.settings, settings);
    this.save(p);
  }
  clearCheckpoint() {
    const p = this.load();
    p.checkpoint = null;
    this.save(p);
  }
  checkpoint(cp: Checkpoint) {
    const p = this.load();
    p.checkpoint = cp;
    this.save(p);
  }
  recordEncounter(c: ClassId) {
    const p = this.load();
    p.progress[c]++;
    this.save(p);
  }
  recordRun(won: boolean, kills: number) {
    const p = this.load();
    p.stats.runs++;
    p.stats.wins += Number(won);
    p.stats.kills += kills;
    p.checkpoint = null;
    this.save(p);
  }
}
