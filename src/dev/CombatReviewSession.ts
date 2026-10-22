import {Simulation} from "../core/simulation";
import {weapons} from "../content";
import {surfacesForBox} from "../content/maps";
import {neutralInput,type BoxDefinition,type GameFrame,type MapDefinition} from "../shared/contracts";

const boxes:BoxDefinition[]=[
  {id:"ground",center:{x:0,y:-.2,z:0},size:{x:22,y:.4,z:28},scoring:true},
  {id:"north",center:{x:0,y:3,z:-12},size:{x:22,y:6,z:.4}},
];
export const combatReviewMap:MapDefinition={id:"combat-review",name:"打击感检视",chapter:0,description:"隔离静止目标，真实射击与伤害",width:22,depth:28,boxes,surfaces:boxes.flatMap(surfacesForBox),spawns:[{x:0,y:0,z:6},{x:0,y:0,z:-6}],enemySpawns:[],anchors:[],objectives:[],navigation:[]};

/** Only public inputs drive the real simulation; no generated hit/death events or state edits. */
export class CombatReviewSession {
  readonly playerId="review-player";
  readonly targetId:string;
  readonly simulation:Simulation;
  frame:GameFrame;
  private sequence=0;
  private queued=0;
  private heldTicks=0;
  private released=true;
  private continuous=false;
  constructor(readonly weaponId:string,enemyId="grunt"){
    const weapon=weapons[weaponId];if(!weapon||weapon.melee)throw new Error("请选择远程武器。");
    this.simulation=new Simulation({modeId:"practice",map:combatReviewMap,seed:41028});
    this.simulation.addPlayer(this.playerId,"试射者",weapon.classId,[weaponId],"blue",{x:0,y:0,z:6});
    this.targetId=this.simulation.addEnemy(enemyId,{x:0,y:0,z:-6})!;
    this.frame=this.simulation.takeFrame();
  }
  fireOnce(){this.queued=Math.min(8,this.queued+1);}
  fireUntilDefeated(){this.continuous=true;}
  stop(){this.continuous=false;this.queued=0;}
  step():GameFrame {
    const snapshot=this.frame.snapshot,player=snapshot.actors.find(a=>a.id===this.playerId)!,target=snapshot.actors.find(a=>a.id===this.targetId);
    const weapon=weapons[this.weaponId],ammo=player.ammo[this.weaponId];
    if(!target?.alive)this.stop();
    if(this.heldTicks===0&&this.released&&(this.queued>0||this.continuous)&&ammo.nextFireAt<=snapshot.time&&ammo.reloadUntil<=snapshot.time&&ammo.clip>0){
      this.heldTicks=weapon.charge?Math.ceil(weapon.charge*60)+1:1;
      if(this.queued>0)this.queued--;
    }
    const primary=this.heldTicks>0;
    if(primary)this.heldTicks--;
    const targetPos=target?.pos??{x:0,y:0,z:-6},dx=targetPos.x-player.pos.x,dz=targetPos.z-player.pos.z,distance=Math.hypot(dx,dz);
    const flight=distance/(weapon.speed??95),targetHeight=targetPos.y+1+(weapon.gravity??0)*flight*flight*.5;
    this.simulation.input(this.playerId,{...neutralInput(),seq:++this.sequence,primary,
      reload:(this.queued>0||this.continuous)&&ammo.clip===0&&ammo.reloadUntil<=snapshot.time,
      yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(player.pos.y+1.62-targetHeight,distance)});
    this.released=!primary;
    this.simulation.step();this.frame=this.simulation.takeFrame();
    if(this.frame.events.some(event=>event.type==="death"&&event.targetId===this.targetId))this.stop();
    return this.frame;
  }
}
