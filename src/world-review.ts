import "@fontsource/patrick-hand";
import {Vector3} from "three";
import {Renderer} from "./client/renderer";
import {GameAudio} from "./client/scene/GameAudio";
import {maps,weapons} from "./content";
import {Simulation} from "./core/simulation";
import {PaintField} from "./core/paint";
import type {GameSnapshot} from "./shared/contracts";

const $=(id:string)=>document.getElementById(id)!;
const select=$("map") as HTMLSelectElement,objective=$("objective") as HTMLSelectElement;
for(const map of Object.values(maps)){const option=document.createElement("option");option.value=map.id;option.textContent=map.name;select.append(option);}
const view=new Renderer($("game") as HTMLCanvasElement,()=>({sensitivity:1,volume:.15,quality:"medium",reduceMotion:true}));
let snapshot:GameSnapshot,overhead=false,cycle=0,pending=false;
const samples:unknown[]=[];
let audioResult:unknown="未运行";
function reset(){
  const sim=new Simulation({mapId:select.value,modeId:"deathmatch",seed:823});
  snapshot=sim.takeFrame().snapshot;
  view.resetSession(snapshot);
}
function guidance(){
  snapshot.modeId=objective.value==="control"?"control":"deathmatch";
  snapshot.objective.zoneId="A";
  snapshot.campaign=objective.value==="defend"?{chapter:0,encounter:0,completed:0,objectiveKind:"defend",choices:[],seed:823,won:false}:undefined;
}
select.onchange=reset;$("reset").onclick=reset;
$("camera").onclick=()=>{overhead=!overhead;$("camera").textContent=overhead?"切换场景视角":"切换俯瞰";};
$("ink").onclick=()=>{
  const map=maps[select.value],paint=new PaintField(map.surfaces,map.boxes);
  for(const [index,s] of map.surfaces.entries()){
    if(s.id.startsWith("ground:")||s.id.startsWith("house")||s.id.startsWith("cover")||s.id.startsWith("easel")){
      for(let i=0;i<3;i++)paint.stamp(s.id,{x:s.center.x+s.u.x*(i-1)*s.width*.25,y:s.center.y+s.u.y*(i-1)*s.width*.25,z:s.center.z+s.u.z*(i-1)*s.width*.25},Math.min(s.width,s.height)*.36,"blue",[0xd66886,0x62b1bb,0xe8ba52,0x9d85bd][(index+i)%4]);
    }
  }
  snapshot.paint=paint.snapshot();view.frame({snapshot,events:[]},"review");
};
$("cycles").onclick=()=>{cycle=10;samples.length=0;pending=false;};
$("sound").onclick=()=>{
  const audio=new GameAudio(()=>.08);audio.unlock();audio.unlock();
  let id=0;for(const w of Object.values(weapons))audio.event({id:++id,type:"shot",actorId:"review"+id,weaponId:w.id},true);
  // This dedicated local tool reports the real WebAudio resource lifecycle, not a mocked context.
  const resources=audio as unknown as {context:AudioContext|null;buffers:Map<string,AudioBuffer>;voices:Set<unknown>};
  audioResult={state:resources.context?.state,buffers:resources.buffers.size,peakVoices:resources.voices.size};
  setTimeout(()=>{audioResult={...audioResult as object,remainingVoices:resources.voices.size};audio.dispose();audio.dispose();},650);
};
function draw(){
  if(cycle&&pending){samples.push({map:select.value,...view.renderer.info.memory,programs:view.renderer.info.programs?.length});select.value=Object.keys(maps)[(10-cycle)%3];reset();cycle--;}
  guidance();view.spectator=overhead?new Vector3(7,34,32):new Vector3(18,9,24);
  view.draw(snapshot,"review",.4,overhead?.78:.26);
  pending=true;
  $("metrics").textContent=JSON.stringify({map:select.value,resources:view.renderer.info.memory,cyclesRemaining:cycle,samples,audio:audioResult},null,2);
  requestAnimationFrame(draw);
}
reset();requestAnimationFrame(draw);
