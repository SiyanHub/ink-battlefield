import type { WeaponDefinition } from "../../shared/contracts";

/** Small, bounded presentation impulses. Never changes simulation time or input aim. */
export class CombatKick {
  private pitch = 0;
  private roll = 0;
  private push = 0;
  private impact = 0;
  private side = 1;
  shot(weapon: WeaponDefinition) {
    const heavy = ["shotgun", "grenade", "rocket", "sniper", "nailgun", "hammer"].includes(weapon.model);
    const soft = ["brush", "roller", "bubble", "minigun"].includes(weapon.model);
    const amount = heavy ? .026 : soft ? .006 : .013;
    this.pitch = Math.min(.042, this.pitch + amount);
    this.roll = Math.max(-.008, Math.min(.008, this.roll + amount * .18 * this.side));
    this.push = Math.min(.055, this.push + amount * 1.1);
    this.side *= -1;
  }
  hit(lethal = false) { this.impact = Math.min(1, this.impact + (lethal ? .8 : .28)); }
  update(dt: number, reduced: boolean) {
    const step = Math.min(.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const decay = Math.exp(-23 * step);
    this.pitch *= decay; this.roll *= decay; this.push *= decay; this.impact *= Math.exp(-14 * step);
    return reduced ? { pitch: 0, roll: 0, push: 0, fov: 0 } : {
      pitch: this.pitch, roll: this.roll, push: this.push,
      fov: this.impact * .7,
    };
  }
  reset() { this.pitch = this.roll = this.push = this.impact = 0; this.side = 1; }
}
