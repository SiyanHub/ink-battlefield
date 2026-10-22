import * as T from "three";
import type {GameSnapshot,MapDefinition,Vec3} from "../../shared/contracts";
import {maps} from "../../content";
import {World} from "../../core/world";
import {distance} from "../../core/math";
import {dispose,label} from "../primitives";

export function nearestPracticeAnchor(map:MapDefinition,feet:Vec3):Vec3|null {
  const world=new World(map),eye={...feet,y:feet.y+1.62};
  return map.anchors.filter(p=>distance(eye,p)<30&&world.visible(eye,p))
    .sort((a,b)=>distance(eye,a)-distance(eye,b))[0]??null;
}

/** One unobtrusive marker in practice only; it teaches real anchors, without adding collision. */
export class PracticeAnchorHint {
  readonly root=new T.Group();
  readonly ring=new T.Mesh(new T.TorusGeometry(.46,.025,5,40),new T.MeshBasicMaterial({color:0x527f9b,transparent:true,opacity:.8,depthWrite:false}));
  private lastUpdate=-1;
  private completed=false;
  constructor(){
    this.ring.layers.set(1);this.root.add(this.ring);
    const title=label("Q 钩索练习",.36);title.position.y=.7;this.root.add(title);
    this.root.visible=false;
  }
  reset(){this.completed=false;this.lastUpdate=-1;this.root.visible=false;}
  complete(){this.completed=true;this.root.visible=false;}
  update(snapshot:GameSnapshot|null,playerId:string,camera:T.Camera){
    if(snapshot?.modeId!=="practice"||this.completed){this.root.visible=false;return;}
    this.ring.quaternion.copy(camera.quaternion);
    if(snapshot.time>=this.lastUpdate&&snapshot.time-this.lastUpdate<.4)return;
    this.lastUpdate=snapshot.time;
    const player=snapshot.actors.find(a=>a.id===playerId);
    const anchor=player?.alive?nearestPracticeAnchor(maps[snapshot.mapId],player.pos):null;
    this.root.visible=!!anchor;if(anchor)this.root.position.copy(anchor);
  }
  dispose(){dispose(this.root);}
}
