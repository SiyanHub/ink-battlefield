import type { ClassId } from "../shared/contracts";
import { classes } from "./classes";
export function createRegistry<T extends { id: string }>() {
  const entries = new Map<string, T>();
  return {
    register(value: T) {
      if (entries.has(value.id))
        throw new Error(`duplicate registration: ${value.id}`);
      entries.set(value.id, value);
      return value;
    },
    get(id: string): T {
      const value = entries.get(id);
      if (!value) throw new Error(`unknown registration: ${id}`);
      return value;
    },
    all: () => [...entries.values()],
  };
}
export function getLoadout(
  classId: ClassId,
  requested: string[] = [],
  unlocked?: string[],
): string[] {
  const c = classes[classId];
  if (!c) throw new Error("unknown class");
  const allowed = c.weapons.filter((w) => !unlocked || unlocked.includes(w));
  const selected = [...new Set(requested)]
    .filter((w) => allowed.includes(w))
    .slice(0, 2);
  if (!selected.length && allowed.length) selected.push(allowed[0]);
  return [...selected, c.melee];
}
