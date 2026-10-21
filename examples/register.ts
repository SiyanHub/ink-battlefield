import { classes, weapons } from "../src/content";
import { weaponBehaviors, traceShot } from "../src/core/combat";
import { modeRegistry } from "../src/core/modes";
import type { WeaponDefinition } from "../src/shared/contracts";

// Opt-in example: call once at application assembly, before constructing any sessions.
// It deliberately does not change Simulation.step, the server tick, or the renderer loop.
export function registerExamples() {
  const chalk: WeaponDefinition = {
    ...weapons.pencil,
    id: "example-chalk",
    name: "示例粉笔",
    description: "一次按键留下宽笔触",
    behavior: "example-chalk-line",
    automatic: false,
    paintRadius: 3,
    model: "pencil",
    spread: 0,
  };
  if (weapons[chalk.id]) throw new Error("example already registered");
  weapons[chalk.id] = chalk;
  classes.artist.weapons.push(chalk.id);
  weaponBehaviors.set(chalk.behavior, (shot) => traceShot(shot));
  modeRegistry.register({
    id: "example-quick-sketch",
    title: "五秒试笔",
    duration: 5,
    target: 100,
    onDeath() {},
    update(rt, state) {
      state.scores = rt.paint.coverage();
      state.objective.description = "五秒后比较留下的笔迹面积";
    },
  });
}
