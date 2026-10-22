import * as T from "three";
import type {MapDefinition} from "../../shared/contracts";

/** Synchronous scene transaction: the caller copies each render before yielding to the browser. */
export function withBattlefieldView(map:MapDefinition,camera:T.PerspectiveCamera,hidden:T.Object3D[],paint:T.Object3D[],draw:(clean:boolean)=>void,compare=false){
  const saved=camera.clone(),visibility=new Map([...hidden,...paint].map(o=>[o,o.visible]));
  try {
    camera.aspect=1.6;camera.fov=52;camera.near=.1;camera.far=220;
    const span=Math.max(map.depth,map.width/1.6);
    camera.position.set(map.width*.12,span*1.4,map.depth*.48);
    camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    for(const object of hidden)object.visible=false;
    if(compare){for(const object of paint)object.visible=false;draw(true);}
    for(const object of paint)object.visible=visibility.get(object)!;
    draw(false);
  } finally {
    camera.copy(saved);camera.updateMatrixWorld(true);
    for(const [object,visible] of visibility)object.visible=visible;
  }
}
