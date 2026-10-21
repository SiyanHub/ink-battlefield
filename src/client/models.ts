import * as T from "three";
import {enemies} from "../content";
import type {ActorSnapshot} from "../shared/contracts";
import {actorGeometry} from "../shared/actor-geometry";
import {part,label} from "./primitives";
import {createPaperRig,posePaperRig} from "./actors/PaperRig";

/** Public model boundary: shared head dimensions, paper anatomy and independent costumes. */
export function actorModel(a:ActorSnapshot,_enemyIndex=0){
  const root=new T.Group(),dims=actorGeometry(a);
  const pigment=a.teamId==="red"?0xb94c51:a.teamId==="blue"?0x47779a:a.color;
  createPaperRig(root,a,pigment);
  const top=(dims.headHeight+dims.headRadius)/dims.heightScale;
  const hp=new T.Mesh(new T.PlaneGeometry(.55,.028),new T.MeshBasicMaterial({color:pigment,side:T.DoubleSide}));
  hp.name="health";hp.layers.set(1);part(root,hp,0,top+.15,0);
  const identity=label(a.kind==="enemy"?(enemies[a.enemyId??""]?.name??"纸兵"):a.name,.18);
  identity.name="identity";part(root,identity,0,top+.34,0);
  const ring=new T.Mesh(new T.RingGeometry(.37,.395,32),new T.MeshBasicMaterial({color:pigment,transparent:true,opacity:.55,side:T.DoubleSide,depthWrite:false}));
  ring.name="identity-ring";ring.layers.set(1);ring.rotation.x=-Math.PI/2;part(root,ring,0,.025,0);
  const ability=new T.Group();ability.name="ability";ability.visible=false;
  const shell=new T.Mesh(a.classId==="heavy"?new T.SphereGeometry(.9,16,10):new T.TorusGeometry(.8,.025,6,32),new T.MeshBasicMaterial({color:pigment,transparent:true,opacity:.25,wireframe:a.classId==="heavy"}));
  shell.layers.set(1);if(a.classId!=="heavy")shell.rotation.x=Math.PI/2;
  part(ability,shell,0,a.classId==="heavy"?1:.1,0);root.add(ability);
  const materials:T.MeshLambertMaterial[]=[];
  root.traverse(o=>{if(o instanceof T.Mesh&&o.material instanceof T.MeshLambertMaterial)materials.push(o.material);});
  root.userData.paintMaterials=materials;root.userData.paintBase=materials.map(m=>m.color.clone());
  return root;
}
export function animateActor(root:T.Group,a:ActorSnapshot,time:number){
  root.position.copy(a.pos);root.rotation.y=a.yaw;root.visible=a.alive;posePaperRig(root,a,time);
  const hp=root.getObjectByName("health");if(hp){hp.visible=a.hp<a.maxHp;hp.scale.x=Math.max(.01,a.hp/a.maxHp);}
  const identity=root.getObjectByName("identity");if(identity)identity.visible=a.kind==="player"||(a.markedUntil??0)>time||!!enemies[a.enemyId??""]?.boss;
  if(root.userData.tint!==a.tint){
    const materials=root.userData.paintMaterials as T.MeshLambertMaterial[];
    materials.forEach((m,i)=>{m.color.copy(root.userData.paintBase[i]);if(a.tint)m.color.lerp(new T.Color(a.tint),.62);});root.userData.tint=a.tint;
  }
  const ability=root.getObjectByName("ability");if(ability)ability.visible=a.skillUntil>time;
}
