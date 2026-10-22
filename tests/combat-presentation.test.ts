import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { CombatEffects } from "../src/client/scene/CombatEffects";
import { ActorView } from "../src/client/scene/ActorView";
import type { ActorSnapshot, GameSnapshot, ProjectileSnapshot } from "../src/shared/contracts";

function actor(id="target"):ActorSnapshot{return {id,name:"纸兵",kind:"enemy",classId:"assault",enemyId:"grunt",teamId:"red",pos:{x:2,y:0,z:3},vel:{x:0,y:0,z:0},yaw:.4,pitch:0,radius:.42,hp:100,maxHp:100,alive:true,grounded:true,respawnAt:0,protectedUntil:0,skillUntil:0,skillCooldown:0,grappleCooldown:0,weaponId:"",weapons:[],ammo:{},kills:0,deaths:0,upgrades:[],color:0xe05b35,tint:0};}
function snapshot(actors:ActorSnapshot[]=[],projectiles:ProjectileSnapshot[]=[]):GameSnapshot{return {tick:1,time:3,phase:"playing",modeId:"deathmatch",mapId:"construction",actors,projectiles,paint:{revision:0,surfaces:[]},scores:{},objective:{title:"",description:"",progress:0,target:1,remaining:1},winner:null,remaining:10};}
function projectile(id="p"):ProjectileSnapshot{return {id,ownerId:"self",teamId:"blue",pos:{x:4,y:2,z:1},vel:{x:100,y:0,z:0},color:0x1977bd,radius:.07,weaponId:"rifle"};}
// Only the DOM label canvas is substituted; real Three models and their transforms run below.
function withLabels(run:()=>void){
  const original=globalThis.document;
  const canvas={width:0,height:0,getContext:()=>({measureText:()=>({width:90}),fillText(){},fillStyle:"",textAlign:"",font:""})};
  Object.defineProperty(globalThis,"document",{configurable:true,value:{createElement:()=>({...canvas})}});
  try{run();}finally{Object.defineProperty(globalThis,"document",{configurable:true,value:original});}
}

test("shots do not leave full-range lines while the grapple rope remains visible",()=>{
  const effects=new CombatEffects();
  try{
    effects.event({id:1,type:"shot",pos:{x:0,y:1,z:0},to:{x:0,y:1,z:-80},color:0x1977bd});
    assert.equal(effects.root.children.filter(o=>o instanceof T.Line).length,0,"a bullet is not a stationary range line");
    effects.event({id:2,type:"grapple",pos:{x:0,y:1,z:0},to:{x:0,y:8,z:-10}});
    assert.equal(effects.root.children.filter(o=>o instanceof T.Line).length,1);
  }finally{effects.dispose();}
});

test("a visible volume follows projectile velocity and has a short bounded tail",()=>{
  const effects=new CombatEffects();
  try{
    effects.update(snapshot([], [projectile()]),0);
    const visual=effects.root.children.find(o=>o.visible)!;
    const forward=new T.Vector3(0,0,1).applyQuaternion(visual.quaternion);
    assert.ok(forward.dot(new T.Vector3(1,0,0))>.999,"the bullet's long axis follows its velocity");
    const size=new T.Box3().setFromObject(visual).getSize(new T.Vector3());
    assert.ok(size.x>size.y*2&&size.y>.06,"bullet volume must be legible, not a point or line");
    assert.ok(Math.max(size.x,size.y,size.z)<2,"the tail must stay close to the bullet");
    effects.update(snapshot(),.016);assert.equal(effects.root.children.filter(o=>o.visible).length,0);
  }finally{effects.dispose();}
});

test("hit feedback faces the impact surface and its pooled burst expires",()=>{
  const effects=new CombatEffects();
  try{
    effects.event({id:1,type:"hit",pos:{x:0,y:1,z:0},normal:{x:1,y:0,z:0},color:0x1977bd});
    const ring=effects.root.children.find(o=>o.visible&&o instanceof T.Mesh&&o.geometry instanceof T.RingGeometry);
    assert.ok(ring,"a hit has a brief expanding impact ring");
    assert.ok(new T.Vector3(0,0,1).applyQuaternion(ring.quaternion).dot(new T.Vector3(1,0,0))>.999);
    const count=effects.root.children.length;
    for(let i=2;i<400;i++)effects.event({id:i,type:"death",pos:{x:0,y:1,z:0},normal:{x:1,y:0,z:0},color:0x1977bd});
    assert.equal(effects.root.children.length,count,"death ink and paper reuse fixed pools");
    assert.ok(effects.root.children.some(o=>o.visible&&o instanceof T.Mesh&&o.geometry instanceof T.PlaneGeometry),"death scatters paper fragments");
    effects.update(null,2);assert.equal(effects.root.children.filter(o=>o.visible).length,0);
    effects.clear();assert.equal(effects.root.children.filter(o=>o.visible).length,0);
  }finally{effects.dispose();}
});

test("projectile overflow is bounded and clear releases active visuals",()=>{
  const effects=new CombatEffects();
  try{
    const base=effects.root.children.length;
    effects.update(snapshot([],Array.from({length:800},(_,i)=>projectile(String(i)))),0);
    assert.ok(effects.root.children.length<=base+384,"a malformed or saturated snapshot cannot allocate unlimited projectiles");
    effects.clear();assert.equal(effects.root.children.filter(o=>o.visible).length,0);
  }finally{effects.dispose();}
});

test("a projectile born and ended between LAN snapshots still travels briefly along its authoritative segment",()=>{
  const effects=new CombatEffects(),p={...projectile(),pos:{x:0,y:1,z:0}};
  try{
    effects.event({id:1,type:"projectile",projectile:p});
    effects.event({id:2,type:"projectile-end",projectileId:p.id,pos:{x:3,y:1,z:0}});
    effects.update(snapshot(),.016);
    const active=effects.root.children.filter(o=>o.visible);
    assert.equal(active.length,1,"an empty 20Hz snapshot must not erase a real short-lived bullet");
    const visual=active[0],first=visual.position.x;
    assert.ok(first>0&&first<3);assert.equal(visual.position.y,1);
    effects.update(snapshot(),.016);assert.ok(visual.position.x>first&&visual.position.x<3);
    assert.equal(effects.root.children.some(o=>o instanceof T.Line),false,"compensation never restores a range line");
    effects.update(snapshot(),.1);assert.equal(visual.visible,false,"visual compensation must finish promptly");
  }finally{effects.dispose();}
});

test("birth events and snapshots share one bullet, and ended IDs cannot reappear from delayed snapshots",()=>{
  const effects=new CombatEffects(),p={...projectile(),pos:{x:0,y:1,z:0}};
  try{
    effects.event({id:1,type:"projectile",projectile:p});
    effects.update(snapshot([], [{...p,pos:{x:5,y:1,z:0}}]),.016);
    assert.equal(effects.root.children.filter(o=>o.visible).length,1);
    const visual=effects.root.children.find(o=>o.visible)!;assert.equal(visual.position.x,5);
    effects.event({id:2,type:"projectile-end",projectileId:p.id,pos:{x:6,y:1,z:0}});
    effects.update(snapshot(),.016);
    assert.ok(visual.position.x>5&&visual.position.x<6,"completion continues from the last shown position, not the muzzle");
    effects.update(snapshot([], [p]),.12);assert.equal(effects.root.children.filter(o=>o.visible).length,0,"a delayed snapshot cannot resurrect an ended bullet");
    effects.clear();effects.event({id:1,type:"projectile",projectile:p});effects.event({id:2,type:"projectile-end",projectileId:p.id,pos:{x:3,y:1,z:0}});effects.update(snapshot(),.016);
    assert.equal(effects.root.children.filter(o=>o.visible).length,1,"new sessions can reuse IDs after clear");
  }finally{effects.dispose();}
});

test("a removed enemy keeps its last pose then falls and expires using presentation time",()=>withLabels(()=>{
  const view=new ActorView(),a=actor();view.update(snapshot([a]),"self",0);
  const body=view.root.children[0],initial=body.quaternion.clone();
  view.event({id:1,type:"death",targetId:a.id,pos:{x:2,y:1,z:3},normal:{x:1,y:0,z:0}},3);
  const terminal={...snapshot(),phase:"victory" as const};
  view.update(terminal,"self",.1);
  assert.equal(body.parent,view.root,"death must outlive authoritative enemy removal");assert.equal(body.visible,true);
  view.update(terminal,"self",.35);assert.ok(initial.angleTo(body.quaternion)>.25,"the retained model visibly tips over");
  view.update(terminal,"self",.7);assert.equal(body.parent,null,"a frozen final tick cannot keep dead models forever");
  view.clear();
}));

test("dead late joins stay absent, respawn replaces a corpse, and reset removes all remnants",()=>withLabels(()=>{
  const view=new ActorView(),a=actor();
  view.update(snapshot([{...a,alive:false,hp:0,deaths:1}]),"self",0);
  assert.equal(view.root.children.length,0,"joining a dead actor does not replay a death that was not observed");
  view.update(snapshot([a]),"self",0);const old=view.root.children[0];
  view.event({id:1,type:"death",targetId:a.id},3);
  view.update(snapshot([{...a,alive:false,hp:0,deaths:1}]),"self",.1);
  view.update(snapshot([{...a,deaths:1,pos:{x:9,y:0,z:0}}]),"self",.05);
  assert.equal(old.parent,null);assert.equal(view.root.children.length,1);assert.equal(view.root.children[0].position.x,9);
  view.clear();assert.equal(view.root.children.length,0);assert.equal(view.actors.size,0);
}));
