import { cycleEquipmentSlot } from "./presenter";
import type { InputFrame } from "../shared/contracts";
export class Input {
  yaw = 0;
  pitch = 0;
  keys = new Set<string>();
  primary = false;
  secondary = false;
  seq = 0;
  slot: number | null = null;
  pulses = new Set<string>();
  enabled = false;
  drag = false;
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly sensitivity: () => number,
    readonly menu: (preservePractice?: boolean) => void,
    readonly scoreboard: (show: boolean) => void,
    readonly notice: (s: string) => void,
  ) {
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.matches("input,select")) return;
      if (["Space", "Tab"].includes(e.code)) e.preventDefault();
      if (e.code === "Escape") {
        this.menu();
        return;
      }
      if (e.code === "KeyP" && !e.repeat) { this.menu(true); return; }
      if (e.code === "Tab") this.scoreboard(true);
      if (!e.repeat) this.pulses.add(e.code);
      this.keys.add(e.code);
      if (/^Digit[123]$/.test(e.code)) this.slot = Number(e.code.slice(-1)) - 1;
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "Tab") this.scoreboard(false);
    });
    window.addEventListener("blur", () => this.clear());
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement !== canvas) this.clear();
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("mousedown", (e) => {
      if (!this.enabled) return;
      this.drag = true;
      if (e.button === 0) this.primary = true;
      if (e.button === 2) this.secondary = true;
      if (document.pointerLockElement !== canvas)
        canvas
          .requestPointerLock()
          ?.catch(() =>
            this.notice("鼠标锁定不可用：按住画面拖动瞄准，Esc 打开菜单"),
          );
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.primary = false;
      if (e.button === 2) this.secondary = false;
      this.drag = this.primary || this.secondary;
    });
    window.addEventListener("mousemove", (e) => {
      if (
        !this.enabled ||
        !(document.pointerLockElement === canvas || this.drag)
      )
        return;
      const s = this.sensitivity() * 0.002;
      this.yaw -= e.movementX * s;
      this.pitch = Math.max(
        -1.45,
        Math.min(1.45, this.pitch + e.movementY * s),
      );
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (this.enabled) {
          e.preventDefault();
          this.slot = e.deltaY > 0 ? -2 : -1;
        }
      },
      { passive: false },
    );
  }
  clear() {
    this.keys.clear();
    this.pulses.clear();
    this.primary = this.secondary = false;
    this.drag = false;
    this.slot = null;
    this.scoreboard(false);
  }
  sample(
    currentSlot: number,
    availableSlots: number[] = [0, 1, 2],
  ): InputFrame {
    const p = (k: string) => this.enabled && this.pulses.has(k);
    const key = (k: string) => this.enabled && this.keys.has(k);
    let slot = this.slot;
    if (slot === -2) slot = cycleEquipmentSlot(currentSlot, 1, availableSlots);
    if (slot === -1) slot = cycleEquipmentSlot(currentSlot, -1, availableSlots);
    if (slot !== null && !availableSlots.includes(slot)) slot = null;
    if (slot !== null && slot !== currentSlot) {
      this.secondary = false;
      this.drag = this.primary;
    }
    const f = {
      seq: ++this.seq,
      moveX: Number(key("KeyD")) - Number(key("KeyA")),
      moveZ: Number(key("KeyW")) - Number(key("KeyS")),
      yaw: this.yaw,
      pitch: this.pitch,
      sprint: key("ShiftLeft") || key("ShiftRight"),
      jump: p("Space"),
      primary: this.enabled && this.primary,
      secondary: this.enabled && this.secondary,
      reload: p("KeyR"),
      skill: p("KeyE"),
      grapple: p("KeyQ"),
      slot: this.enabled ? slot : null,
    };
    this.pulses.clear();
    this.slot = null;
    return f;
  }
}
