import * as T from "three";
import "@fontsource/patrick-hand";
import {Simulation} from "./core/simulation";
import {classes,enemies,weapons} from "./content";
import type {ActorSnapshot,ClassId,GameSnapshot} from "./shared/contracts";
import {ActorView} from "./client/scene/ActorView";
import {SketchPipeline} from "./client/render/SketchPipeline";
const $=(id:string)=>document.getElementById(id)!;
const group=$("group") as HTMLSelectElement,select=$("actor") as HTMLSelectElement,equipment=$("weapon") as HTMLSelectElement,action=$("action") as HTMLSelectElement;
const sim=new Simulation({modeId:"deathmatch",mapId:"construction"}),defaults=["rifle","shotgun","revolver","brush"];
Object.values(classes).forEach((c,i)=>sim.addPlayer(c.id,c.name,c.id as ClassId,[defaults[i]],"blue"));
for(const e of Object.values(enemies))sim.addEnemy(e.id,{x:0,y:0,z:0});
const base=sim.getSnapshot(),library=base.actors;
for(const a of library){const o=document.createElement("option");o.value=a.id;o.textContent=a.name;select.append(o);}
for(const w of Object.values(weapons)){const o=document.createElement("option");o.value=w.id;o.textContent=w.name;equipment.append(o);}
const renderer=new T.WebGLRenderer({canvas:document.querySelector("canvas")!,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.setClearColor(0xf2efe6);
const scene=new T.Scene();scene.fog=new T.Fog(0xf2efe6,24,70);scene.add(new T.HemisphereLight(0xfff7e5,0x85867c,1.5));
const light=new T.DirectionalLight(0xfff9eb,1.3);light.position.set(-4,8,5);scene.add(light);
const ground=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshLambertMaterial({color:0xe9e4d9}));ground.rotation.x=-Math.PI/2;ground.position.y=-.01;scene.add(ground);
const view=new ActorView();scene.add(view.root);
const camera=new T.PerspectiveCamera(35,innerWidth/innerHeight,.04,100);camera.layers.enable(1);
const pipeline=new SketchPipeline(renderer);
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();pipeline.resize(innerWidth,innerHeight,renderer.getPixelRatio());}
resize();addEventListener("resize",resize);
let snapshot:GameSnapshot,turn=false,cycle=0,lastPulse=0;
const samples:object[]=[];
function rebuild(){
  const selected=library.filter(a=>group.value==="players"?a.kind==="player":group.value==="enemies"?a.kind==="enemy"&&!enemies[a.enemyId!].boss:group.value==="bosses"?!!enemies[a.enemyId!]?.boss:a.id===select.value);
  const spacing=group.value==="bosses"?6.4:group.value==="enemies"?2.2:1.8;
  const actors=selected.map((a,i)=>({...structuredClone(a),pos:{x:(i-(selected.length-1)/2)*spacing,y:0,z:0},yaw:Math.PI,markedUntil:1e9,weaponId:a.kind==="player"&&equipment.value?equipment.value:a.weaponId}));
  snapshot={...structuredClone(base),actors};view.clear();view.update(snapshot,"");
  const height=group.value==="bosses"?3.8:group.value==="enemies"?3.6:group.value==="single"&&selected[0]?.radius>.8?3.8:2;
  const distance=group.value==="single"?height*2.4:Math.max(7.5,selected.length*spacing*1.3);
  camera.position.set(group.value==="single"?distance*.26:distance*.08,height*.72,distance);
  camera.lookAt(0,height*.48,0);$("caption").textContent=selected.map(a=>a.name).join("   /   ");
}
group.onchange=select.onchange=equipment.onchange=rebuild;
select.onchange=()=>{group.value="single";rebuild();};
$("turn").onclick=()=>{turn=!turn;$("turn").textContent=turn?"停止转台":"开启转台";};
$("cycle").onclick=()=>{group.value="single";samples.length=0;cycle=26;};
const clock=new T.Clock();
function loop(){
  const sampling=cycle>0;
  if(cycle){
    select.value=library[(26-cycle)%library.length].id;rebuild();cycle--;
  }
  const time=clock.getElapsedTime();snapshot.time=time;
  for(const a of snapshot.actors){
    a.yaw=Math.PI+(turn?time*.45:0);a.vel={x:0,y:0,z:action.value==="walk"?3.6:0};a.tint=action.value==="hurt"?0x62b6a7:0;
    a.telegraphUntil=action.value==="attack"&&time%1.2<.6?time+.5:0;
  }
  view.update(snapshot,"");
  if(time-lastPulse>1.2){
    if(action.value==="attack")for(const a of snapshot.actors)view.event({id:1,type:"shot",actorId:a.id},time);
    if(action.value==="hurt")for(const a of snapshot.actors)view.event({id:1,type:"hit",targetId:a.id},time);
    lastPulse=time;
  }
  pipeline.render(scene,camera,time,true);
  if(sampling)samples.push({actor:select.value,...renderer.info.memory});
  const gripGaps:object[]=[];
  view.root.updateMatrixWorld(true);
  for(const [id,model] of view.actors){
    const held=model.getObjectByName("held-weapon");if(!held)continue;
    for(const [name,side] of [["grip-anchor",held.userData.model==="bow"?-1:1],["support-anchor",held.userData.model==="bow"?1:-1]] as const){
      const anchor=held.getObjectByName(name),hand=model.getObjectByName("hand"+side);
      if(anchor&&hand)gripGaps.push({id,anchor:name,gapMetres:+anchor.getWorldPosition(new T.Vector3()).distanceTo(hand.getWorldPosition(new T.Vector3())).toFixed(4)});
    }
  }
  $("metrics").textContent=JSON.stringify({geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length,cyclesRemaining:cycle,gripGaps,samples});
  requestAnimationFrame(loop);
}
rebuild();requestAnimationFrame(loop);
