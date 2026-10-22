import * as T from "three";
import type { WeaponDefinition } from "../shared/contracts";
import { buildWeapon } from "./weapons";
import { applyWeaponPaper } from "./render/WeaponPaper";
import { dispose, part, shape } from "./primitives";

type V = [number,number,number];
interface Hold { position: V; rotation: V; grip: V; support?: V; tool?: boolean; scale?: number; }
const long: Hold = {position:[.22,-.24,-.43],rotation:[.04,.13,-.035],grip:[0,-.13,.165],support:[0,-.066,-.34],scale:.58};
const tool: Hold = {position:[.19,-.18,-.45],rotation:[.12,.2,.1],grip:[0,0,.045],tool:true,scale:.62};
const holds: Record<string,Hold> = {
  rifle:long,carbine:long,lmg:{...long,position:[.23,-.26,-.47]},
  smg:{...long,position:[.21,-.24,-.44],support:[0,-.061,-.23]},
  shotgun:{...long,support:[0,-.07,-.39]},
  grenade:{...long,position:[.22,-.25,-.46],support:[0,-.09,-.24]},
  sniper:{...long,position:[.23,-.25,-.46],grip:[0,-.085,.145]},
  revolver:{position:[.22,-.22,-.54],rotation:[.07,.17,-.035],grip:[0,-.135,.135],scale:.68},
  pencil:tool,brush:{...tool,position:[.19,-.17,-.45]},pen:tool,
  katana:{...tool,position:[.29,-.24,-.63],rotation:[.94,.05,-.2],grip:[0,0,.07]},
  hammer:{...tool,position:[.28,-.23,-.63],rotation:[.92,.1,-.14]},
  compass:{...tool,position:[.24,-.21,-.55],rotation:[.55,.22,-.25],grip:[0,0,.13]},
  roller:{...tool,position:[.24,-.23,-.61],rotation:[.72,.16,-.13]},
  bow:{position:[-.22,-.16,-.7],rotation:[.025,-.2,.10],grip:[0,0,0],support:[.04,0,.14],scale:.7},
  dual:{position:[0,-.22,-.46],rotation:[.02,0,0],grip:[.145,-.126,.087],support:[-.145,-.126,.062],scale:.68},
  scatter:{...long,position:[.23,-.25,-.45]},
  rocket:{...long,position:[.25,-.27,-.43],scale:.55},
  minigun:{...long,position:[.24,-.27,-.46],scale:.53},
  crossbow:{...long,position:[.20,-.25,-.49],scale:.65},
  nailgun:{...long,position:[.23,-.24,-.45]},
  bucket:{position:[.25,-.28,-.55],rotation:[.12,.12,.03],grip:[.185,.14,-.15],support:[-.13,-.17,-.15],scale:.7},
  bubble:{...long,position:[.23,-.27,-.46],scale:.62},
};

function limb(parent: T.Group,a: V,b: V,r1: number,r2: number,color: number) {
  const start=new T.Vector3(...a),end=new T.Vector3(...b),delta=end.clone().sub(start);
  const o=shape(new T.CylinderGeometry(r1,r2,delta.length(),8),color);
  o.position.copy(start.add(end).multiplyScalar(.5));
  o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()); parent.add(o);
  return o;
}
function hand(at: V,left: boolean,toolGrip=false) {
  const root=new T.Group(); root.position.set(...at);
  // Soft mitten volume plus continuous curled fingers, with the thumb above
  // the palm. The wrist remains below / behind the working end of every tool.
  const palm=shape(new T.SphereGeometry(1,10,7),0xe5dfcc);
  palm.scale.set(.038,.048,.026); part(root,palm,left?-.022:.022,-.005,.023);
  const side=left?-1:1;
  const finger=(points:V[],radius:number)=>{
    const path=new T.CatmullRomCurve3(points.map(([x,y,z])=>new T.Vector3(x*side,y,z)));
    root.add(shape(new T.TubeGeometry(path,8,radius,6,false),0xf3eddb));
  };
  for(let i=0;i<4;i++) {
    const y=.026-i*.021;
    finger([[.03,y,.025],[.042,y,-.004],[.024,y,-.031],[-.012,y,-.027]],i===3?.0085:.010);
  }
  finger([[.029,.023,.04],[.012,.042,.025],[-.017,.033,.004]],.013);
  const wrist=shape(new T.SphereGeometry(1,10,7),0xe5dfcc);
  wrist.scale.set(.027,.035,.025); part(root,wrist,.014,-.06,.028);
  if(toolGrip) root.rotation.x=-Math.PI/2;
  return root;
}
export interface WeaponMotion {
  time: number; dt: number; reloadRemaining: number; charge: number;
  speed: number; reduceMotion: boolean; aim: boolean;
}
/** Client-only presentation. One owned model; replacement disposes every part. */
export class WeaponView {
  readonly root=new T.Group();
  definition: WeaponDefinition | null=null;
  private model: T.Group | null=null;
  private pose=long;
  private shotAt=-100;
  private shotPending=false;
  private reloadTotal=0;
  private wasReloading=false;
  private equip=1;
  private aimAmount=0;
  private flashes:T.Mesh[]=[];
  private barrelAngle=0;
  private barrelSpeed=0;
  private impactAt=-100;
  private impactPending=false;
  private impactStrength=0;
  private arms: {node:T.Group;hand:T.Group;end:T.Vector3;length:number}[]=[];
  private rest=new Map<T.Object3D,{p:T.Vector3;r:T.Euler}>();
  set(w: WeaponDefinition) {
    if(this.definition?.id===w.id) return;
    for(const child of [...this.root.children]) dispose(child);
    this.rest.clear(); this.definition=w; this.pose=holds[w.model]??long;
    this.arms=[]; this.root.scale.setScalar(this.pose.scale??.62);
    this.model=buildWeapon(w); this.root.add(this.model);
    const grip=this.model.getObjectByName("grip-anchor");
    const supportAnchor=this.model.getObjectByName("support-anchor");
    this.pose={...this.pose,grip:grip?grip.position.toArray() as V:this.pose.grip,
      support:supportAnchor?supportAnchor.position.toArray() as V:undefined};
    const muzzle=this.model.getObjectByName("muzzle");
    this.flashes=[];
    if(muzzle&&!w.melee&&w.model!=="bow") {
      const positions=w.model==="dual"?[new T.Vector3(-.145,.029,-.331),new T.Vector3(.145,.029,-.306)]:[muzzle.position];
      for(const position of positions){
        const flash=new T.Mesh(new T.IcosahedronGeometry(.024,1),new T.MeshBasicMaterial({color:w.color,transparent:true,opacity:.8,depthWrite:false}));
        flash.name="ink-pulse";flash.position.copy(position);flash.visible=false;flash.layers.set(1);
        this.model.add(flash);this.flashes.push(flash);
      }
    }
    const bow=w.model==="bow";
    const h=hand(this.pose.grip,bow,this.pose.tool);
    h.name="trigger-hand"; this.model.add(h);
    const attachArm=(glove:T.Group,end:V,color:number,wideSupport=false)=>{
      const wrist=new T.Vector3(.018,-.04,.024).applyQuaternion(glove.quaternion).add(glove.position);
      const length=wrist.distanceTo(new T.Vector3(...end));
      const node=limb(this.model!,wrist.toArray() as V,end,wideSupport?.099:.092,wideSupport?.046:.043,color);
      node.name="paper-sleeve";
      const cuff=shape(new T.CylinderGeometry(wideSupport?.051:.048,wideSupport?.049:.046,.046,10),0xb9b6a9);
      part(node,cuff,0,-length/2+.024,0);
      // One seam reads as a folded sleeve without covering it in wire edges.
      const seam=new T.Line(new T.BufferGeometry().setFromPoints([
        new T.Vector3(.028,-length/2+.045,.03),new T.Vector3(.052,.01,.047),new T.Vector3(.065,length/2,.055)]),
        new T.LineBasicMaterial({color:0x77786f,transparent:true,opacity:.35}));
      seam.layers.set(1); node.add(seam);
      this.arms.push({node,hand:glove,end:new T.Vector3(...end),length});
    };
    attachArm(h,[bow?-.27:.25,-.42,.37],0xc1c7c3);
    if(this.pose.support) {
      const off=hand(this.pose.support,!bow,bow||this.pose.tool);
      off.name="support-hand"; this.model.add(off);
      // Enter from the lower left rather than falling vertically under the
      // fore-end: this keeps the supporting sleeve readable as an arm.
      attachArm(off,[bow?.22:-.5,-.42,.25],0xddd5c2,!bow);
    }
    applyWeaponPaper(this.model);
    this.model.traverse(o=>this.rest.set(o,{p:o.position.clone(),r:o.rotation.clone()}));
    this.equip=1; this.aimAmount=0; this.shotAt=-100; this.impactAt=-100; this.shotPending=this.impactPending=false; this.wasReloading=false;this.barrelAngle=this.barrelSpeed=0;
  }
  shot(color?:number) {
    this.shotPending=true;
    for(const flash of this.flashes)(flash.material as T.MeshBasicMaterial).color.setHex(color??this.definition?.color??0x1977bd);
  }
  impact(lethal=false) { this.impactPending=true; this.impactStrength=lethal?1:.45; }
  update(m: WeaponMotion) {
    const w=this.definition;
    if(!w || !this.model) return;
    // Start on the next presented frame, so slow frames and first equip cannot consume the whole flash unseen.
    if(this.shotPending){this.shotAt=m.time-Math.min(Math.max(0,m.dt),1/120);this.shotPending=false;}
    if(this.impactPending){this.impactAt=m.time;this.impactPending=false;}
    this.equip=Math.max(0,this.equip-m.dt*5);
    const age=Math.max(0,m.time-this.shotAt);
    const recoil=Math.exp(-age*19)*Math.min(age*70,1);
    const impactAge=Math.max(0,m.time-this.impactAt);
    const punch=Math.exp(-impactAge*28)*this.impactStrength;
    const swing=age<.42?Math.sin(Math.min(1,age/.42)*Math.PI):0;
    const loading=m.reloadRemaining>0;
    if(loading&&!this.wasReloading) this.reloadTotal=m.reloadRemaining;
    this.wasReloading=loading;
    const reload=loading?Math.max(0,Math.min(1,1-m.reloadRemaining/Math.max(.01,this.reloadTotal))):0;
    const dip=loading?Math.sin(reload*Math.PI):0;
    const bob=m.reduceMotion?0:Math.sin(m.time*9)*Math.min(.006,m.speed*.0008);
    const [px,py,pz]=this.pose.position,[rx,ry,rz]=this.pose.rotation;
    const heavy=["shotgun","rocket","grenade","nailgun","sniper"].includes(w.model);
    const soft=["brush","roller","minigun"].includes(w.model);
    const strength=(heavy?.11:w.model==="revolver"?.095:soft?.032:.055)*(m.reduceMotion?.65:1);
    this.root.position.set(px-(w.melee?swing*.15:0),py+bob-dip*.085-this.equip*.18-punch*.009,pz+(w.melee?-swing*.05:recoil*strength)-punch*.012);
    this.root.rotation.set(rx+(w.melee?-swing*.95:recoil*strength*2.4)-dip*.19,ry+(w.melee?swing*.55:0),rz+dip*.43+this.equip*.25+punch*.012);
    const aiming=m.aim&&!loading&&!w.melee;
    this.aimAmount+=((aiming?1:0)-this.aimAmount)*(m.reduceMotion?1:1-Math.exp(-22*m.dt));
    const sight=this.model.getObjectByName("sight-anchor");
    if(sight){
      // Align the real front post and rear notch with the optical centre.
      this.root.position.lerp(new T.Vector3(0,-sight.position.y*this.root.scale.y,pz+recoil*strength*.35),this.aimAmount);
      this.root.rotation.x*=1-this.aimAmount;this.root.rotation.y*=1-this.aimAmount;this.root.rotation.z*=1-this.aimAmount;
    }else if(!w.melee){
      this.root.position.x*=1-this.aimAmount*.25;
      this.root.rotation.y*=1-this.aimAmount*.6;
    }
    for(const [o,r] of this.rest) { o.position.copy(r.p); o.rotation.copy(r.r); }
    for(const flash of this.flashes) {
      flash.visible=age<.065;
      flash.scale.set(.9+age*14,.9+age*14,1.8+age*22);
      (flash.material as T.MeshBasicMaterial).opacity=.9*Math.max(0,1-age/.065);
      flash.rotation.z=age*40;
    }
    const obj=(name: string)=>this.model!.getObjectByName(name);
    if(w.model==="minigun"){
      this.barrelSpeed+=((age<.15?32:0)-this.barrelSpeed)*(1-Math.exp(-9*m.dt));
      this.barrelAngle+=this.barrelSpeed*m.dt;
      const barrels=obj("barrel-cluster");if(barrels)barrels.rotation.z=this.barrelAngle;
    }
    if(w.model==="bucket"){
      this.root.rotation.x-=swing*.55;this.root.position.y+=swing*.07;this.root.position.z-=swing*.08;
    }
    if(w.model==="crossbow"){
      const bolt=obj("loaded-bolt"),tip=obj("bolt-tip"),feather=obj("feather");
      for(const part of [bolt,tip,feather])if(part)part.visible=age>.2;
    }
    const magazine=obj("magazine");
    if(magazine) magazine.position.y-=dip*.16;
    const cylinder=obj("cylinder");
    if(cylinder&&loading) { cylinder.position.x-=dip*.08; cylinder.rotation.y+=reload*Math.PI*2; }
    const pump=obj("pump");
    const cycle=age<.5?Math.sin(Math.max(0,age-.08)/.42*Math.PI)*.055:0;
    if(pump) pump.position.z+=Math.max(0,cycle);
    const support=obj("support-hand");
    if(support&&pump) support.position.z+=Math.max(0,cycle);
    if(support&&magazine&&loading) {
      const at=this.rest.get(magazine)!.p;
      // Reach down to the magazine and return to the fore-end.
      support.position.lerp(new T.Vector3(at.x-.02,at.y-.07-dip*.16,at.z),dip);
    }
    if(w.model==="bow") {
      const string=obj("bowstring") as T.Line;
      const positions=string.geometry.getAttribute("position") as T.BufferAttribute;
      positions.setZ(1,.14+m.charge*.16); positions.needsUpdate=true;
      string.geometry.computeBoundingSphere();
      const arrow=obj("arrow"); if(arrow) arrow.position.z=m.charge*.16;
      if(support) support.position.z+=m.charge*.16;
    }
    if(w.model==="roller") { const roll=obj("roller"); if(roll) roll.rotation.y=swing*2; }
    for(const arm of this.arms) {
      const wrist=new T.Vector3(.018,-.04,.024).applyQuaternion(arm.hand.quaternion).add(arm.hand.position);
      const delta=arm.end.clone().sub(wrist);
      arm.node.position.copy(wrist.add(arm.end).multiplyScalar(.5));
      arm.node.scale.y=delta.length()/arm.length;
      arm.node.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());
    }
  }
}
