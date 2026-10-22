import * as T from "three";
import type {GameSnapshot,GameEvent} from "../../shared/contracts";
import {weapons} from "../../content";
import {actorModel,animateActor} from "../models";
import {buildWeapon} from "../weapons";
import {dispose} from "../primitives";
import {ActorDeath} from "./ActorDeath";
const enemyEquipment:Record<string,string>={grunt:"katana",rusher:"compass",brute:"hammer",marksman:"rifle",painter:"brush",doodler:"hammer",maestro:"brush"};
export class ActorView {
  readonly root=new T.Group();
  readonly actors=new Map<string,T.Group>();
  private deaths=new Map<string,ActorDeath>();
  update(s:GameSnapshot,playerId:string,dt=0){
    const ids=new Set(s.actors.map(a=>a.id));
    for(const [id,g] of this.actors)if(!ids.has(id)){dispose(g);this.actors.delete(id);}
    for(const a of s.actors){
      if(a.id===playerId)continue;
      const death=this.deaths.get(a.id);
      if(!a.alive){
        if(!death)this.beginDeath(a.id);
        const falling=this.deaths.get(a.id);if(falling)falling.seenDead=true;
        continue;
      }
      if(death){
        // A stale/interpolated alive snapshot must not resurrect the just-killed model.
        if(!death.seenDead&&a.deaths<=death.deaths)continue;
        dispose(death.model);this.deaths.delete(a.id);
      }
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
      g.userData.deaths=a.deaths;
    }
    for(const [id,death] of this.deaths)if(!death.advance(dt)){dispose(death.model);this.deaths.delete(id);}
  }
  event(event:GameEvent,time:number){
    if(event.type==="shot"||event.type==="telegraph"){
      const actor=this.actors.get(event.actorId??"");if(actor)actor.userData.attackTime=time;
    }
    if(event.type==="hit"){
      const actor=this.actors.get(event.targetId??"");if(actor)actor.userData.hurtTime=time;
    }
    if(event.type==="death")this.beginDeath(event.targetId??"",event.normal);
    if(event.type==="spawn"){
      const id=event.actorId??"",death=this.deaths.get(id);if(death){dispose(death.model);this.deaths.delete(id);}
    }
  }
  private beginDeath(id:string,normal?:GameEvent["normal"]){
    const actor=this.actors.get(id);if(!actor||this.deaths.has(id))return;
    // At most 32 complete rigs survive after death; effects themselves have separate fixed pools.
    if(this.deaths.size>=32){const oldest=this.deaths.entries().next().value!;dispose(oldest[1].model);this.deaths.delete(oldest[0]);}
    this.actors.delete(id);this.deaths.set(id,new ActorDeath(actor,normal));
  }
  clear(){for(const g of this.actors.values())dispose(g);this.actors.clear();for(const death of this.deaths.values())dispose(death.model);this.deaths.clear();}
}
