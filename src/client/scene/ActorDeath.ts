import * as T from "three";
import type {Vec3} from "../../shared/contracts";

/** Keeps the rendered pose, independent of a removed actor or a stopped simulation clock. */
export class ActorDeath {
  age=0;
  seenDead=false;
  readonly deaths:number;
  private origin:T.Vector3;
  private rotation:T.Quaternion;
  private direction:T.Vector3;
  private axis:T.Vector3;
  private materials:{material:T.Material;opacity:number}[]=[];
  private parts:{part:T.Object3D;position:T.Vector3;rotation:T.Quaternion;drift:T.Vector3}[]=[];
  constructor(readonly model:T.Group,normal?:Vec3){
    this.deaths=model.userData.deaths??0;this.origin=model.position.clone();this.rotation=model.quaternion.clone();
    this.direction=normal?new T.Vector3(-normal.x,0,-normal.z):new T.Vector3(0,0,1).applyQuaternion(model.quaternion);
    if(this.direction.lengthSq()<.001)this.direction.set(.6,0,.8);this.direction.normalize();
    this.axis=new T.Vector3().crossVectors(new T.Vector3(0,1,0),this.direction).normalize();
    model.visible=true;
    for(const name of ["health","identity","identity-ring","ability"]){const object=model.getObjectByName(name);if(object)object.visible=false;}
    const materials=new Set<T.Material>();
    model.traverse(object=>{
      const mesh=object as T.Mesh;if(!mesh.material)return;
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material);
    });
    for(const material of materials){this.materials.push({material,opacity:material.opacity});material.transparent=true;material.needsUpdate=true;}
    for(const [index,part] of (model.getObjectByName("body")?.children??[]).entries()){
      this.parts.push({part,position:part.position.clone(),rotation:part.quaternion.clone(),drift:new T.Vector3(Math.cos(index*2.399)*.23,.08+(index%3)*.035,Math.sin(index*2.399)*.19)});
    }
  }
  /** Returns false once the complete reaction has finished. */
  advance(dt:number):boolean {
    this.age+=Math.max(0,Number.isFinite(dt)?dt:0);
    if(this.age>=1.02)return false;
    const t=Math.min(1,this.age/.63),fall=t*t*(3-2*t),scatter=Math.max(0,(this.age-.48)/.54);
    this.model.quaternion.copy(this.rotation).premultiply(new T.Quaternion().setFromAxisAngle(this.axis,fall*1.43));
    this.model.position.copy(this.origin).addScaledVector(this.direction,fall*.25);this.model.position.y+=fall*.11;
    for(const {part,position,rotation,drift} of this.parts){part.position.copy(position).addScaledVector(drift,scatter);part.quaternion.copy(rotation);}
    const opacity=1-Math.max(0,(this.age-.66)/.36);
    for(const item of this.materials)item.material.opacity=item.opacity*opacity;
    return true;
  }
}
