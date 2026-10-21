import * as T from "three";
import type { MapDefinition } from "../../shared/contracts";
import { box,dispose,part,label } from "../primitives";
import { PaintView } from "../paint";
import { ThreatView } from "../threats";
import { addMapArt } from "./MapArt";
import { ObjectiveView } from "./ObjectiveView";

/** One map owns its geometry, decorative marks, paint and telegraphs. */
export class WorldView {
  readonly root=new T.Group();
  readonly paint:PaintView;
  readonly threats:ThreatView;
  readonly objectives:ObjectiveView;
  constructor(readonly map:MapDefinition) {
    this.root.name="map:"+map.id;
    this.threats=new ThreatView(this.root);
    for(const b of map.boxes){
      const ground=b.id==="ground",boundary=["north","south","east","west"].includes(b.id);
      const tint=ground?0xe9e5db:boundary?0xd6d2c8:b.id.includes("pillar")?0xc0bbb0:b.color??0xe5e0d5;
      const mesh=part(this.root,box(b.size.x,b.size.y,b.size.z,tint),b.center.x,b.center.y,b.center.z);
      if(ground)mesh.traverse(o=>{if(o instanceof T.Mesh)o.castShadow=false;});
    }
    addMapArt(this.root,map);
    // Wide, very light paving joints; leave paper breathing room between strokes.
    const paving:T.Vector3[]=[];
    for(let x=-map.width/2;x<=map.width/2;x+=4)paving.push(new T.Vector3(x,.016,-map.depth/2),new T.Vector3(x,.016,map.depth/2));
    for(let z=-map.depth/2;z<=map.depth/2;z+=4)paving.push(new T.Vector3(-map.width/2,.016,z),new T.Vector3(map.width/2,.016,z));
    this.inkLines(paving,.10);
    // Sketch skyline remains outside the boundary and cannot be mistaken for cover.
    for(let i=0;i<13;i++){
      const h=5+(i*7%9),w=3+(i%3);
      part(this.root,box(w,h,4,0xe2ded5),-29+i*4.8,h/2,-map.depth/2-7-(i%3)*3);
    }
    const heading=label(map.name+" / "+String(map.chapter+1).padStart(2,"0"),.8);
    part(this.root,heading,0,6,-map.depth/2-1);
    for(const a of map.anchors){
      const marker=new T.Mesh(new T.OctahedronGeometry(.12),new T.MeshBasicMaterial({color:0x688bab}));
      marker.layers.set(1);part(this.root,marker,a.x,a.y,a.z);
      const ring=new T.Mesh(new T.TorusGeometry(.25,.012,4,24),new T.MeshBasicMaterial({color:0x688bab,transparent:true,opacity:.7}));
      ring.layers.set(1);part(this.root,ring,a.x,a.y,a.z);
    }
    this.objectives=new ObjectiveView(map);this.root.add(this.objectives.root);
    this.paint=new PaintView(this.root,map.surfaces);
  }
  private inkLines(points:T.Vector3[],opacity:number){
    const lines=new T.LineSegments(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:0x655f54,transparent:true,opacity,depthWrite:false}));
    lines.layers.set(1);this.root.add(lines);
  }
  dispose(){this.threats.reset();dispose(this.root);}
}
