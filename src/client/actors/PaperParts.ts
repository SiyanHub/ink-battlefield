import * as T from "three";
import {part,shape} from "../primitives";
export const paper=0xe9e3d7, cloth=0xb9b5aa, dark=0x4d504e, edge=0x343834;
export type Point=[number,number,number];
/** A continuous faceted volume; rings are [height, half-width, half-depth]. */
export function form(rings:Point[],color=paper,sides=8){
  const p:number[]=[],indices:number[]=[];
  for(const [y,rx,rz] of rings)for(let i=0;i<sides;i++){
    const a=i*Math.PI*2/sides+Math.PI/sides;p.push(Math.cos(a)*rx,y,Math.sin(a)*rz);
  }
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<sides;i++){
    const a=j*sides+i,b=j*sides+(i+1)%sides,c=a+sides,d=b+sides;indices.push(a,c,b,b,c,d);
  }
  for(const row of [0,rings.length-1]){
    const center=p.length/3;p.push(0,rings[row][0],0);
    for(let i=0;i<sides;i++){
      const a=row*sides+i,b=row*sides+(i+1)%sides;
      indices.push(...(row===0?[center,a,b]:[center,b,a]));
    }
  }
  const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(p,3));g.setIndex(indices);
  // Smooth broad volumes; silhouette and true folds keep their pencil outlines.
  // Flat normals here turn every triangulation edge into a dark wire cage.
  g.computeVertexNormals();return shape(g,color);
}
export function stroke(parent:T.Group,points:Point[],color=edge,opacity=.8){
  const g=new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(...p)));
  const line=new T.Line(g,new T.LineBasicMaterial({color,transparent:true,opacity}));line.layers.set(1);parent.add(line);return line;
}
export function plate(parent:T.Group,points:Point[],color=paper){
  const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(points.flat(),3));
  const ix:number[]=[];for(let i=1;i<points.length-1;i++)ix.push(0,i,i+1);g.setIndex(ix);g.computeVertexNormals();
  const group=shape(g,color);const mesh=group.children[0] as T.Mesh; (mesh.material as T.MeshLambertMaterial).side=T.DoubleSide;parent.add(group);return group;
}
export function patch(parent:T.Group,w:number,h:number,x:number,y:number,z:number,color:number){
  const mesh=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color,side:T.DoubleSide}));
  mesh.layers.set(1);part(parent,mesh,x,y,z);return mesh;
}
export function segment(parent:T.Group,name:string,top:number,bottom:number,color:number){
  const s=form([[-.5,bottom,bottom*.85],[.28,top,top*.9],[.5,top*.94,top*.85]],color);s.name=name;parent.add(s);return s;
}
export function placeSegment(segment:T.Object3D,a:T.Vector3,b:T.Vector3){
  const delta=a.clone().sub(b);segment.position.copy(a).add(b).multiplyScalar(.5);
  segment.scale.y=delta.length();segment.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());
}
