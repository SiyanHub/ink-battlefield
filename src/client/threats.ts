import * as T from "three";
import type { GameEvent, GameSnapshot } from "../shared/contracts";
import { dispose, label } from "./primitives";
/** Telegraph durations and targets come from the authoritative frame, never local attack timers. */
export class ThreatView {
  warnings = new Map<string, { group: T.Group; until: number }>();
  marks = new Map<string, T.Group>();
  constructor(readonly world: T.Group) {}
  reset() {
    for (const w of this.warnings.values()) dispose(w.group);
    for (const m of this.marks.values()) dispose(m);
    this.warnings.clear();
    this.marks.clear();
  }
  event(event: GameEvent, snapshot: GameSnapshot) {
    if (event.type !== "telegraph" || !event.actorId) return;
    const actor = snapshot.actors.find((a) => a.id === event.actorId);
    if (!actor || !actor.alive) return;
    const old = this.warnings.get(actor.id);
    if (old) dispose(old.group);
    const group = new T.Group(),
      text = event.text ?? actor.telegraph ?? "攻击预警";
    const target = event.pos ?? actor.pos;
    const material = new T.MeshBasicMaterial({
      color: 0xd75c47,
      transparent: true,
      opacity: 0.32,
      side: T.DoubleSide,
      depthWrite: false,
    });
    const radial = text.includes("横扫")
      ? 6
      : text.includes("震地")
        ? 8
        : text.includes("俯冲")
          ? 3.2
          : 0;
    if (radial) {
      const ring = new T.Mesh(
        new T.RingGeometry(radial - 0.14, radial, 64),
        material,
      );
      ring.rotation.x = -Math.PI / 2;
      const center = text.includes("俯冲") ? target : actor.pos;
      ring.position.set(center.x, 0.065, center.z);
      group.add(ring);
      const area = new T.Mesh(
        new T.CircleGeometry(radial, 64),
        material.clone(),
      );
      (area.material as T.MeshBasicMaterial).opacity = 0.09;
      area.rotation.x = -Math.PI / 2;
      area.position.copy(ring.position);
      group.add(area);
    } else if (text.includes("冲锋")) {
      const direction = new T.Vector3(
        target.x - actor.pos.x,
        0,
        target.z - actor.pos.z,
      ).normalize();
      const lane = new T.Mesh(new T.PlaneGeometry(5, 9.35), material);
      lane.rotation.x = -Math.PI / 2;
      lane.rotation.z = Math.atan2(-direction.x, -direction.z);
      lane.position.set(
        actor.pos.x + direction.x * 4.675,
        0.065,
        actor.pos.z + direction.z * 4.675,
      );
      group.add(lane);
    } else {
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(actor.pos.x, actor.pos.y + 1.3, actor.pos.z),
          new T.Vector3(target.x, target.y, target.z),
        ]),
        new T.LineDashedMaterial({
          color: 0xd75c47,
          dashSize: 0.3,
          gapSize: 0.2,
        }),
      );
      line.computeLineDistances();
      group.add(line);
    }
    const title = label("⚠ " + text, 0.48);
    title.position.set(
      actor.pos.x,
      actor.pos.y + Math.max(2.6, actor.radius * 5),
      actor.pos.z,
    );
    const titleMaterial = title.material as T.SpriteMaterial;
    titleMaterial.depthTest = false;
    titleMaterial.depthWrite = false;
    title.renderOrder = 50;
    group.add(title);
    this.world.add(group);
    this.warnings.set(actor.id, {
      group,
      until: actor.telegraphUntil ?? snapshot.time + 0.65,
    });
  }
  update(snapshot: GameSnapshot) {
    for (const [id, w] of this.warnings) {
      const actor = snapshot.actors.find((a) => a.id === id);
      if (snapshot.time > w.until || !actor?.alive) {
        dispose(w.group);
        this.warnings.delete(id);
      }
    }
    const marked = new Set(
      snapshot.actors
        .filter((a) => a.alive && (a.markedUntil ?? 0) > snapshot.time)
        .map((a) => a.id),
    );
    for (const [id, m] of this.marks)
      if (!marked.has(id)) {
        dispose(m);
        this.marks.delete(id);
      }
    for (const actor of snapshot.actors) {
      if (!marked.has(actor.id)) continue;
      let marker = this.marks.get(actor.id);
      if (!marker) {
        marker = new T.Group();
        const tag = label("◇ 侦察标记", 0.4);
        (tag.material as T.SpriteMaterial).depthTest = false;
        (tag.material as T.SpriteMaterial).depthWrite = false;
        tag.renderOrder = 60;
        marker.add(tag);
        const ring = new T.Mesh(
          new T.TorusGeometry(actor.radius + 0.18, 0.035, 4, 32),
          new T.MeshBasicMaterial({
            color: 0xd5932f,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 0.85,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.45;
        marker.add(ring);
        this.marks.set(actor.id, marker);
        this.world.add(marker);
      }
      marker.position.set(
        actor.pos.x,
        actor.pos.y + Math.max(2.1, actor.radius * 4.5),
        actor.pos.z,
      );
      marker.scale.setScalar(1 + Math.sin(snapshot.time * 4) * 0.035);
    }
  }
}
