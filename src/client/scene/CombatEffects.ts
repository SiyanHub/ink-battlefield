import * as T from "three";
import type {GameEvent,GameSnapshot} from "../../shared/contracts";
import {dispose} from "../primitives";
/** Transient effects have fixed capacity; persistent ink is owned by PaintView. */
export class CombatEffects {
  readonly root=new T.Group();
  private particles: {mesh:T.Mesh;velocity:T.Vector3;life:number;total:number}[]=[];
  private cursor=0;
  private trails:{line:T.Line;life:number}[]=[];
  private projectiles=new Map<string,T.Mesh>();
  constructor(){
    for(let i=0;i<128;i++){
      const mesh=new T.Mesh(new T.IcosahedronGeometry(.025,0),new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.8,depthWrite:false}));
      mesh.layers.set(1);mesh.visible=false;this.root.add(mesh);
      this.particles.push({mesh,velocity:new T.Vector3(),life:0,total:1});
    }
  }
  event(e:GameEvent){
    if(e.to&&e.pos&&(e.type==="shot"||e.type==="grapple")){
      if(this.trails.length>=24){dispose(this.trails.shift()!.line);}
      const line=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(e.pos.x,e.pos.y,e.pos.z),new T.Vector3(e.to.x,e.to.y,e.to.z)]),new T.LineBasicMaterial({color:e.color??0x6b879d,transparent:true,opacity:.42,depthWrite:false}));
      line.layers.set(1);this.root.add(line);this.trails.push({line,life:.07});
    }
    if(e.pos&&["hit","death","skill"].includes(e.type)){
      const count=e.type==="death"?20:e.type==="skill"?24:8;
      for(let i=0;i<count;i++){
        const p=this.particles[this.cursor++%this.particles.length];
        p.mesh.visible=true;p.mesh.position.set(e.pos.x,e.pos.y,e.pos.z);
        (p.mesh.material as T.MeshBasicMaterial).color.set(e.color??0xd65f78);
        const angle=(i*2.399+e.id*.73),speed=e.type==="skill"?4:1.7;
        p.velocity.set(Math.cos(angle)*speed,1.2+(i%5)*.35,Math.sin(angle)*speed);
        p.total=p.life=.32+(i%5)*.05;p.mesh.scale.setScalar(.5+(i%4)*.45);
      }
    }
  }
  update(s:GameSnapshot|null,dt:number){
    for(const p of this.particles)if(p.life>0){
      p.life-=dt;p.mesh.visible=p.life>0;p.velocity.y-=dt*6;p.mesh.position.addScaledVector(p.velocity,dt);
      (p.mesh.material as T.MeshBasicMaterial).opacity=Math.max(0,p.life/p.total)*.8;
    }
    this.trails=this.trails.filter(t=>{t.life-=dt;if(t.life<=0){dispose(t.line);return false;}return true;});
    const ids=new Set(s?.projectiles.map(p=>p.id)??[]);
    for(const [id,m] of this.projectiles)if(!ids.has(id)){dispose(m);this.projectiles.delete(id);}
    for(const p of s?.projectiles??[]){
      let m=this.projectiles.get(p.id);
      if(!m){
        m=new T.Mesh(new T.IcosahedronGeometry(p.radius,1),new T.MeshBasicMaterial({color:p.color}));
        m.layers.set(1);this.projectiles.set(p.id,m);this.root.add(m);
      }
      m.position.set(p.pos.x,p.pos.y,p.pos.z);
    }
  }
  clear(){
    for(const p of this.particles){p.life=0;p.mesh.visible=false;}
    for(const t of this.trails)dispose(t.line);this.trails=[];
    for(const m of this.projectiles.values())dispose(m);this.projectiles.clear();
  }
  dispose(){this.clear();dispose(this.root);}
}
