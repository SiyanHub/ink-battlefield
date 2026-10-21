import * as T from "three";
import type {GameSnapshot,MapDefinition} from "../../shared/contracts";
import {label,part} from "../primitives";

/** Non-solid world guidance. Scoring and target health come solely from the snapshot. */
export class ObjectiveView {
  readonly root=new T.Group();
  private zones:{id:string;root:T.Group;material:T.MeshBasicMaterial}[]=[];
  private defense=new T.Group();
  constructor(map:MapDefinition){
    for(const zone of map.objectives){
      const root=new T.Group();root.position.copy(zone.center);this.root.add(root);
      const material=new T.MeshBasicMaterial({color:0x537e9c,transparent:true,opacity:.75,side:T.DoubleSide,depthWrite:false});
      const ring=new T.Mesh(new T.RingGeometry(zone.radius-.065,zone.radius,72),material);
      ring.rotation.x=-Math.PI/2;ring.layers.set(1);part(root,ring,0,.04,0);
      part(root,label(zone.id+" / "+zone.name,.32),0,.65,0);
      this.zones.push({id:zone.id,root,material});
    }
    // A translucent projection cannot be mistaken for collision cover.
    const beacon=new T.Mesh(new T.OctahedronGeometry(.55),new T.MeshBasicMaterial({color:0x6b9d9c,wireframe:true,transparent:true,opacity:.8,depthWrite:false}));
    beacon.layers.set(1);part(this.defense,beacon,0,1.2,0);
    part(this.defense,label("守护画心",.4),0,2.3,0);
    if(map.objectives[0])this.defense.position.copy(map.objectives[0].center);
    this.root.add(this.defense);this.update(null);
  }
  update(snapshot:GameSnapshot|null){
    const task=snapshot?.campaign?.objectiveKind;
    const campaignZone=task==="paint"||task==="defend";
    for(const [index,z] of this.zones.entries()){
      z.root.visible=!!snapshot&&(snapshot.modeId==="control"||!!campaignZone&&index===0);
      z.material.opacity=snapshot?.objective.zoneId===z.id||campaignZone? .8:.16;
      // Inactive control points keep a faint ring, without competing labels.
      z.root.children[1].visible=snapshot?.objective.zoneId===z.id||!!campaignZone;
    }
    this.defense.visible=task==="defend";
    if(snapshot)this.defense.children[0].rotation.y=snapshot.time*.25;
  }
}
