import * as T from "three";
import type {ActorSnapshot} from "../../shared/contracts";
import {actorGeometry} from "../../shared/actor-geometry";
import {box,part} from "../primitives";
import {cloth,dark,form,paper,placeSegment,segment,stroke} from "./PaperParts";
import {dressActor} from "./Costume";
interface Arm {side:number;shoulder:T.Vector3;upper:T.Group;lower:T.Group;elbow:T.Group;hand:T.Group;}
interface Rig {body:T.Group;head:T.Group;arms:Arm[];legs:{hip:T.Group;knee:T.Group;side:number}[];flight:boolean;}
export function createPaperRig(root:T.Group,a:ActorSnapshot,pigment:number){
  const dims=actorGeometry(a),heavy=a.classId==="heavy"||a.enemyId==="brute"||a.enemyId==="doodler";
  const flight=a.enemyId==="flyer"||a.enemyId==="origami",width=heavy?.34:a.enemyId==="rusher"?.23:.275;
  const body=new T.Group();body.name="body";root.add(body);
  const rig:Rig={body,head:new T.Group(),arms:[],legs:[],flight};root.userData.rig=rig;
  part(body,form(flight?[[.64,.03,.04],[.93,.22,.14],[1.22,.29,.13],[1.3,.10,.07]]:[[.81,.18,.125],[1.05,width,.16],[1.23,width*.94,.14],[1.3,.13,.10]],paper),0,0,0);
  if(!flight)part(body,form([[.70,.18,.12],[.85,.21,.14]],cloth),0,0,0);
  part(body,form([[1.27,.067,.063],[1.39,.063,.06]],cloth),0,0,0);
  const head=rig.head;head.name="head";part(body,head,0,1.52,0);
  // Head size follows shared hit dimensions, independent of broad boss shoulders.
  head.scale.set(dims.headRadius/(.2*dims.horizontalScale),dims.headRadius/(.2*dims.heightScale),dims.headRadius/(.2*dims.horizontalScale));
  part(head,form([[-.19,.075,.085],[-.11,.14,.145],[.07,.174,.177],[.16,.132,.14],[.19,.065,.075]],paper),0,0,0);
  dressActor(body,head,a,pigment,width);
  for(const side of [-1,1]){
    const hip=new T.Group();hip.name="leg"+side;part(body,hip,side*.125,.77,0);
    part(hip,form([[-(flight?.18:.35),.08,.075],[-.04,heavy?.14:.105,heavy?.13:.10],[.02,.11,.10]],cloth),0,0,0);
    const knee=new T.Group();part(hip,knee,0,-(flight?.18:.35),0);
    part(knee,form([[-(flight?.14:.31),.062,.06],[-.05,.08,.075],[.02,.085,.075]],paper),0,0,0);
    if(flight)for(const toe of [-1,1])stroke(knee,[[toe*.035,-.12,0],[toe*.055,-.2,-.09],[toe*.04,-.19,-.15]],dark,1);
    else part(knee,form([[-.045,.078,.12],[.028,.072,.10],[.07,.057,.065]],dark),0,-.35,-.045);
    if(heavy)part(knee,box(.15,.12,.05,paper),0,-.02,-.08);
    stroke(hip,[[side*.07,-.04,-.07],[side*.055,-.30,-.07]],dark,.35);rig.legs.push({hip,knee,side});
    if(flight)continue;
    const shoulder=new T.Vector3(side*(width+.015),1.24,0);
    const upper=segment(body,"upper-arm"+side,heavy?.145:.115,.082,cloth);
    const lower=segment(body,"forearm"+side,heavy?.12:.084,.056,paper);
    const elbow=part(body,form([[-.045,.082,.079],[.045,.082,.079]],dark),0,0,0) as T.Group;
    const hand=new T.Group();hand.name="hand"+side;body.add(hand);
    part(hand,form([[-.06,.043,.034],[.035,.05,.038],[.06,.035,.03]],paper),0,0,0);
    for(let i=0;i<3;i++)stroke(hand,[[-.035,.026-i*.026,-.035],[.035,.026-i*.026,-.035]],dark,.45);
    part(hand,form([[-.045,.018,.021],[.025,.02,.023]],cloth),side<0?.04:-.04,0,-.01).rotation.z=side*.35;
    rig.arms.push({side,shoulder,upper,lower,elbow,hand});
  }
  root.scale.set(dims.horizontalScale,dims.heightScale,dims.horizontalScale);
}
function reach(arm:Arm,target:T.Vector3,rotation:T.Quaternion){
  const start=arm.shoulder,dir=target.clone().sub(start),distance=Math.min(.719,Math.max(.08,dir.length()));dir.normalize();
  const end=start.clone().addScaledVector(dir,distance);
  const bend=new T.Vector3(arm.side*.35,-.7,.55);bend.addScaledVector(dir,-bend.dot(dir)).normalize();
  const mid=start.clone().addScaledVector(dir,distance*.5).addScaledVector(bend,Math.sqrt(Math.max(0,.36**2-(distance*.5)**2)));
  placeSegment(arm.upper,start,mid);placeSegment(arm.lower,mid,end);
  arm.elbow.position.copy(mid);arm.hand.position.copy(end);arm.hand.quaternion.copy(rotation);
}
export function posePaperRig(root:T.Group,a:ActorSnapshot,time:number){
  const rig=root.userData.rig as Rig,walk=Math.min(1,Math.hypot(a.vel.x,a.vel.z)/3.6);
  const gait=time*(a.enemyId==="rusher"?12:8),hurt=Math.max(0,1-(time-(root.userData.hurtTime??-10))*6);
  rig.body.rotation.z=Math.sin((1-hurt)*12)*hurt*.06;
  rig.head.rotation.x=-Math.max(-.25,Math.min(.25,a.pitch));
  for(const {hip,knee,side} of rig.legs){
    const stride=Math.sin(gait)*side;hip.rotation.x=rig.flight?-.65:stride*.5*walk;
    knee.rotation.x=rig.flight?.95:-Math.max(0,-stride)*.72*walk;
  }
  for(const side of [-1,1]){const wing=rig.body.getObjectByName("wing"+side);if(wing)wing.rotation.z=side*(.05+Math.sin(time*5)*.18);}
  const weapon=rig.body.getObjectByName("held-weapon"),age=time-(root.userData.attackTime??-10),attack=age>=0&&age<.5?Math.sin(age/.5*Math.PI):0;
  if(weapon){
    const melee=weapon.userData.melee as boolean,bow=weapon.userData.model==="bow";
    const grip=weapon.getObjectByName("grip-anchor")?.position??new T.Vector3(0,-.13,.165);
    weapon.rotation.set((melee?1.05:0)-a.pitch-(melee?attack*1.45:0),melee?attack*.45:0,melee?-.12:0);
    const target=new T.Vector3(bow?-.16:melee?.24:.12,melee?.98:1.12,melee?-.10:-.14);
    if((a.ammo[a.weaponId]?.reloadUntil??0)>time){weapon.rotation.z=-.28;target.y-=.10;}
    if(!melee)target.z+=attack*.025;
    weapon.position.copy(target).sub(grip.clone().multiplyScalar(weapon.scale.x).applyEuler(weapon.rotation));weapon.updateMatrix();
    const mainSide=bow?-1:1;
    for(const arm of rig.arms){
      const anchor=weapon.getObjectByName(arm.side===mainSide?"grip-anchor":"support-anchor");
      const dest=anchor?anchor.position.clone().applyMatrix4(weapon.matrix):new T.Vector3(arm.side*.32,.64,-.04);
      reach(arm,dest,anchor?weapon.quaternion:new T.Quaternion());
    }
  }else for(const arm of rig.arms){
    const windup=(a.telegraphUntil??0)>time;
    reach(arm,new T.Vector3(arm.side*(rig.flight?.35:.29),windup?1.27:.65,windup?-.38:Math.sin(gait)*walk*.10),new T.Quaternion());
  }
}
