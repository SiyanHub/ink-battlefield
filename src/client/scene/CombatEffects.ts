import * as T from "three";
import type {GameEvent,GameSnapshot,ProjectileSnapshot} from "../../shared/contracts";
import {weapons} from "../../content";
import {dispose} from "../primitives";

interface Particle {mesh:T.Mesh<T.BufferGeometry,T.MeshBasicMaterial>;velocity:T.Vector3;spin:T.Vector3;life:number;total:number;paper:boolean;}
interface Ring {mesh:T.Mesh<T.RingGeometry,T.MeshBasicMaterial>;life:number;total:number;radius:number;}
interface Flight {projectile:ProjectileSnapshot;origin:T.Vector3;end?:T.Vector3;age:number;observed:boolean;}
const forward=new T.Vector3(0,0,1),up=new T.Vector3(0,1,0),MAX_PROJECTILES=384;

/** All transient pools are bounded. Ink on the world remains owned by PaintView. */
export class CombatEffects {
  readonly root=new T.Group();
  private particles:Particle[]=[];
  private scraps:Particle[]=[];
  private rings:Ring[]=[];
  private cursor=0;
  private scrapCursor=0;
  private ringCursor=0;
  private trails:{line:T.Line;life:number}[]=[];
  private projectiles=new Map<string,T.Group>();
  private freeProjectiles:T.Group[]=[];
  private projectileCount=0;
  private flights=new Map<string,Flight>();
  private ended=new Map<string,number>();
  private direction=new T.Vector3();
  constructor(){
    for(let i=0;i<256+64;i++){
      const paper=i>=256;
      const mesh=new T.Mesh(paper?new T.PlaneGeometry(.11,.075):new T.IcosahedronGeometry(.04,1),new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthWrite:false,side:paper?T.DoubleSide:T.FrontSide}));
      mesh.layers.set(1);mesh.visible=false;this.root.add(mesh);
      (paper?this.scraps:this.particles).push({mesh,velocity:new T.Vector3(),spin:new T.Vector3(),life:0,total:1,paper});
    }
    for(let i=0;i<24;i++){
      const mesh=new T.Mesh(new T.RingGeometry(.79,1,24),new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthWrite:false,side:T.DoubleSide}));
      mesh.layers.set(1);mesh.visible=false;this.root.add(mesh);this.rings.push({mesh,life:0,total:1,radius:1});
    }
  }
  event(e:GameEvent){
    if(e.type==="projectile"&&e.projectile){
      if(!this.flights.has(e.projectile.id)&&!this.ended.has(e.projectile.id))this.rememberFlight(e.projectile,false);
      return;
    }
    if(e.type==="projectile-end"&&e.projectileId&&e.pos){
      if(this.ended.has(e.projectileId))return;
      const flight=this.flights.get(e.projectileId);
      if(flight){
        const visual=this.projectiles.get(e.projectileId);
        flight.origin.copy(visual?.position??flight.origin);flight.end=new T.Vector3(e.pos.x,e.pos.y,e.pos.z);flight.age=0;
      }
      if(this.ended.size>=MAX_PROJECTILES)this.ended.delete(this.ended.keys().next().value!);
      this.ended.set(e.projectileId,.45);
      return;
    }
    // Shot is only a trigger/muzzle event. Its authoritative moving projectile owns the flight visual.
    if(e.type==="grapple"&&e.to&&e.pos){
      if(this.trails.length>=24)dispose(this.trails.shift()!.line);
      const line=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(e.pos.x,e.pos.y,e.pos.z),new T.Vector3(e.to.x,e.to.y,e.to.z)]),new T.LineBasicMaterial({color:e.color??0x6b879d,transparent:true,opacity:.55,depthWrite:false}));
      line.layers.set(1);this.root.add(line);this.trails.push({line,life:.12});
    }
    if(!e.pos||!["paint","hit","death","skill"].includes(e.type))return;
    const normal=new T.Vector3(e.normal?.x??0,e.normal?.y??1,e.normal?.z??0);
    if(normal.lengthSq()<.0001)normal.copy(up);normal.normalize();
    const tangent=new T.Vector3().crossVectors(normal,Math.abs(normal.y)<.8?up:forward).normalize();
    const bitangent=new T.Vector3().crossVectors(normal,tangent);
    const death=e.type==="death",skill=e.type==="skill",paint=e.type==="paint",count=death?30:skill?24:paint?6:12;
    const color=e.color??0x1977bd;
    for(let i=0;i<count;i++){
      const p=this.particles[this.cursor++%this.particles.length],angle=i*2.399+e.id*.73;
      const spread=(death?3.3:skill?4:paint?1.15:2.1)*(.55+(i%4)*.15);
      p.mesh.visible=true;p.mesh.position.set(e.pos.x,e.pos.y,e.pos.z).addScaledVector(normal,.04);p.mesh.material.color.setHex(color);p.mesh.material.opacity=1;
      p.velocity.copy(normal).multiplyScalar(death?1.6:paint?.7:1.15).addScaledVector(tangent,Math.cos(angle)*spread).addScaledVector(bitangent,Math.sin(angle)*spread);
      if(death||skill)p.velocity.y+=1.8+(i%4)*.2;
      p.total=p.life=(death?.45:paint?.18:.25)+(i%5)*.035;p.mesh.scale.setScalar((death?1.8:paint?.7:1)+(i%4)*.25);p.spin.set(0,0,0);
    }
    if(!skill){
      const ring=this.rings[this.ringCursor++%this.rings.length];
      ring.mesh.visible=true;ring.mesh.position.set(e.pos.x,e.pos.y,e.pos.z).addScaledVector(normal,.045);ring.mesh.quaternion.setFromUnitVectors(forward,normal);
      ring.mesh.material.color.setHex(color);ring.mesh.material.opacity=.95;ring.mesh.scale.setScalar(death?.18:.07);
      ring.total=ring.life=death?.32:paint?.18:.22;ring.radius=death?.85:paint?.26:.43;
    }
    if(death)for(let i=0;i<12;i++){
      const p=this.scraps[this.scrapCursor++%this.scraps.length],angle=i*2.399+e.id*.73;
      p.mesh.visible=true;p.mesh.position.set(e.pos.x,e.pos.y,e.pos.z);p.mesh.material.color.setHex(i%3===0?color:0xf2e9d5);p.mesh.material.opacity=1;
      p.velocity.set(Math.cos(angle)*1.9,1.6+(i%4)*.4,Math.sin(angle)*1.9).addScaledVector(normal,.8);
      p.spin.set(4+i%3,5-i%4,3+i%5);p.mesh.rotation.set(angle,.3*i,.5*i);p.mesh.scale.setScalar(.8+(i%4)*.3);p.total=p.life=.65+(i%4)*.08;
    }
  }
  update(s:GameSnapshot|null,dt:number){
    dt=Math.max(0,Number.isFinite(dt)?dt:0);
    for(const pool of [this.particles,this.scraps])for(const p of pool)if(p.life>0){
      p.life-=dt;p.mesh.visible=p.life>0;
      if(p.life<=0)continue;
      p.velocity.y-=dt*(p.paper?3:7);p.mesh.position.addScaledVector(p.velocity,dt);
      p.mesh.rotation.x+=p.spin.x*dt;p.mesh.rotation.y+=p.spin.y*dt;p.mesh.rotation.z+=p.spin.z*dt;
      p.mesh.material.opacity=Math.min(1,p.life/p.total*2);
    }
    for(const ring of this.rings)if(ring.life>0){ring.life-=dt;ring.mesh.visible=ring.life>0;const t=1-Math.max(0,ring.life)/ring.total;ring.mesh.scale.setScalar(.07+ring.radius*t);ring.mesh.material.opacity=(1-t)*.95;}
    this.trails=this.trails.filter(t=>{t.life-=dt;if(t.life<=0){dispose(t.line);return false;}return true;});
    this.updateProjectiles(s,dt);
  }
  private rememberFlight(p:ProjectileSnapshot,observed:boolean){
    if(this.flights.size>=MAX_PROJECTILES)this.flights.delete(this.flights.keys().next().value!);
    const flight:Flight={projectile:{...p,pos:{...p.pos},vel:{...p.vel}},origin:new T.Vector3(p.pos.x,p.pos.y,p.pos.z),age:0,observed};
    this.flights.set(p.id,flight);return flight;
  }
  private updateProjectiles(s:GameSnapshot|null,dt:number){
    for(const [id,life] of this.ended){if(life<=dt)this.ended.delete(id);else this.ended.set(id,life-dt);}
    const visible=new Map<string,ProjectileSnapshot>();
    for(const p of (s?.projectiles??[]).slice(0,MAX_PROJECTILES)){
      if(this.ended.has(p.id))continue;
      visible.set(p.id,p);
      const flight=this.flights.get(p.id)??this.rememberFlight(p,true);
      flight.observed=true;flight.age=0;flight.projectile={...p,pos:{...p.pos},vel:{...p.vel}};
    }
    for(const [id,flight] of this.flights){
      if(visible.has(id))continue;
      flight.age+=dt;
      if(flight.end){
        // A complete flight can happen between two 20Hz snapshots. Replay only its
        // authoritative short segment, using the same entity ID and no damage prediction.
        if(flight.age>=.075){this.flights.delete(id);continue;}
        const position=flight.origin.clone().lerp(flight.end,flight.age/.075),velocity=flight.end.clone().sub(flight.origin);
        if(visible.size<MAX_PROJECTILES)visible.set(id,{...flight.projectile,pos:position,vel:velocity});
      }else if(!flight.observed&&flight.age<.1){
        const position=flight.origin.clone().addScaledVector(new T.Vector3().copy(flight.projectile.vel),Math.min(.075,flight.age));
        if(visible.size<MAX_PROJECTILES)visible.set(id,{...flight.projectile,pos:position});
      }else this.flights.delete(id);
    }
    const ids=new Set(visible.keys());
    for(const [id,group] of this.projectiles)if(!ids.has(id)){group.visible=false;this.freeProjectiles.push(group);this.projectiles.delete(id);}
    for(const p of visible.values()){
      let group=this.projectiles.get(p.id);
      if(!group){group=this.acquireProjectile();if(!group)continue;this.configureProjectile(group,p);this.projectiles.set(p.id,group);}
      group.visible=true;group.position.set(p.pos.x,p.pos.y,p.pos.z);
      this.direction.set(p.vel.x,p.vel.y,p.vel.z);if(this.direction.lengthSq()>.0001)group.quaternion.setFromUnitVectors(forward,this.direction.normalize());
    }
  }
  private acquireProjectile():T.Group|undefined {
    const free=this.freeProjectiles.pop();if(free)return free;
    if(this.projectileCount>=MAX_PROJECTILES)return;
    this.projectileCount++;
    const group=new T.Group();group.name="flying-ink";
    const body=new T.Mesh(new T.IcosahedronGeometry(1,1),new T.MeshBasicMaterial({color:0xffffff}));
    const core=new T.Mesh(new T.IcosahedronGeometry(1,1),new T.MeshBasicMaterial({color:0xffffff}));
    const tail=new T.Mesh(new T.ConeGeometry(1,1,8),new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.34,depthWrite:false}));tail.rotation.x=-Math.PI/2;
    group.add(body,core,tail);group.traverse(o=>o.layers.set(1));this.root.add(group);return group;
  }
  private configureProjectile(group:T.Group,p:ProjectileSnapshot){
    const model=weapons[p.weaponId]?.model??p.weaponId;
    const heavy=["rocket","grenade"].includes(model),needle=["bow","crossbow","nailgun","sniper","pen"].includes(model),blob=["bucket","bubble","brush","spray"].includes(model);
    const radius=Math.min(.24,Math.max(blob?.12:heavy?.11:.065,p.radius)),length=blob?radius*2.6:heavy?.58:needle?.48:model==="shotgun"||model==="scatter"?.20:.30;
    const tailLength=Math.min(.8,length*(blob?1.1:1.9));
    const [body,core,tail]=group.children as T.Mesh<T.BufferGeometry,T.MeshBasicMaterial>[];
    body.scale.set(radius,radius,length*.5);body.material.color.setHex(p.color);
    core.scale.set(radius*.42,radius*.42,length*.31);core.position.set(0,radius*.31,length*.13);core.material.color.setHex(p.color).lerp(new T.Color(0xfff6dd),.68);
    tail.scale.set(radius*.65,tailLength,radius*.65);tail.position.set(0,0,-length*.5-tailLength*.5);tail.material.color.setHex(p.color);
  }
  clear(){
    for(const pool of [this.particles,this.scraps])for(const p of pool){p.life=0;p.mesh.visible=false;}
    for(const ring of this.rings){ring.life=0;ring.mesh.visible=false;}
    for(const t of this.trails)dispose(t.line);this.trails=[];
    for(const group of this.projectiles.values()){group.visible=false;this.freeProjectiles.push(group);}this.projectiles.clear();
    this.flights.clear();this.ended.clear();
    this.cursor=this.scrapCursor=this.ringCursor=0;
  }
  dispose(){this.clear();dispose(this.root);this.freeProjectiles=[];}
}
