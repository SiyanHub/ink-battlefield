import * as T from "three";
import type {GameSnapshot,GameEvent} from "../../shared/contracts";
import {weapons} from "../../content";
import {actorModel,animateActor} from "../models";
import {buildWeapon} from "../weapons";
import {dispose} from "../primitives";
const enemyEquipment:Record<string,string>={grunt:"katana",rusher:"compass",brute:"hammer",marksman:"rifle",painter:"brush",doodler:"hammer",maestro:"brush"};
export class ActorView {
  readonly root=new T.Group();
  readonly actors=new Map<string,T.Group>();
  update(s:GameSnapshot,playerId:string){
    const ids=new Set(s.actors.map(a=>a.id));
    for(const [id,g] of this.actors)if(!ids.has(id)){dispose(g);this.actors.delete(id);}
    for(const a of s.actors){
      if(a.id===playerId)continue;
      let g=this.actors.get(a.id);
      const key=a.classId+":"+a.enemyId;
      if(g&&g.userData.modelKey!==key){dispose(g);this.actors.delete(a.id);g=undefined;}
      if(!g){g=actorModel(a);g.userData.modelKey=key;this.actors.set(a.id,g);this.root.add(g);}
      const weaponId=a.kind==="player"?a.weaponId:enemyEquipment[a.enemyId??""];
      if(g.userData.weaponId!==weaponId){
        const old=g.getObjectByName("held-weapon");if(old)dispose(old);
        const def=weapons[weaponId];
        if(def){const held=buildWeapon(def);held.name="held-weapon";held.scale.setScalar(.72);held.userData.melee=def.melee;held.userData.model=def.model;g.getObjectByName("body")!.add(held);}
        g.userData.weaponId=weaponId;g.userData.hasHeldWeapon=!!def;
      }
      animateActor(g,a,s.time);
    }
  }
  event(event:GameEvent,time:number){
    if(event.type==="shot"||event.type==="telegraph"){
      const actor=this.actors.get(event.actorId??"");if(actor)actor.userData.attackTime=time;
    }
    if(event.type==="hit"){
      const actor=this.actors.get(event.targetId??"");if(actor)actor.userData.hurtTime=time;
    }
  }
  clear(){for(const g of this.actors.values())dispose(g);this.actors.clear();}
}
