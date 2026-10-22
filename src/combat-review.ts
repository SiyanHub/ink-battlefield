import * as T from "three";
import "@fontsource/patrick-hand";
import {maps,weapons} from "./content";
import {Renderer} from "./client/renderer";
import {CombatReviewSession,combatReviewMap} from "./dev/CombatReviewSession";
import type {GameFrame,Profile} from "./shared/contracts";

const $=(id:string)=>document.getElementById(id)!;
const weapon=$("weapon") as HTMLSelectElement,camera=$("camera") as HTMLSelectElement,speed=$("speed") as HTMLSelectElement,stop=$("stop") as HTMLSelectElement;
for(const definition of Object.values(weapons).filter(w=>!w.melee)){const option=document.createElement("option");option.value=definition.id;option.textContent=definition.name;weapon.append(option);}
weapon.value="rifle";
// This map registration is confined to the development entry point and its own browser realm.
maps[combatReviewMap.id]=combatReviewMap;
const settings:Profile["settings"]={quality:"medium",volume:.5,sensitivity:1,reduceMotion:false};
const renderer=new Renderer($("scene") as HTMLCanvasElement,()=>settings);
let session:CombatReviewSession,paused=true,presentationTime=0,accumulator=0,last=performance.now(),raf=0;
let log:string[]=[],totalShots=0,totalHits=0,totalDeaths=0,deathAt:number|null=null;
function status(){
  const s=session.frame.snapshot,target=s.actors.find(a=>a.id===session.targetId),age=deathAt===null?"":` · 倒地动作 ${(presentationTime-deathAt).toFixed(2)}s`;
  $("status").textContent=`${paused?"已暂停":"播放中"} · 仿真 ${s.time.toFixed(3)}s / tick ${s.tick} · 飞行弹体 ${s.projectiles.length} · 目标 ${target?.hp??0}/${target?.maxHp??90}${age}`;
  $("events").textContent=`真实事件累计：shot ${totalShots} / hit ${totalHits} / death ${totalDeaths}\n${log.join("\n")}`;
  $("play").textContent=paused?"播放":"暂停";$("play").classList.toggle("active",!paused);
}
function draw(dt=0){
  const s=session.frame.snapshot,player=s.actors.find(a=>a.id===session.playerId)!;
  let yaw=player.yaw,pitch=player.pitch,viewer=session.playerId;
  if(camera.value!=="first"){
    const position=camera.value==="close"?new T.Vector3(3.9,2.1,-1.4):new T.Vector3(12,4.2,7.8),target=camera.value==="close"?new T.Vector3(0,.85,-6):new T.Vector3(0,1,-.7);
    const direction=target.sub(position);yaw=Math.atan2(-direction.x,-direction.z);pitch=Math.atan2(-direction.y,Math.hypot(direction.x,direction.z));
    renderer.spectator=position;viewer="review-observer";
  }else renderer.spectator=null;
  $("crosshair").style.display=camera.value==="first"?"block":"none";
  renderer.draw(s,viewer,yaw,pitch,{time:presentationTime,dt});status();
}
function accept(frame:GameFrame){
  renderer.frame(frame,session.playerId);
  for(const event of frame.events){
    if(event.type==="shot")totalShots++;
    if(event.type==="hit")totalHits++;
    if(event.type==="death"){totalDeaths++;deathAt=presentationTime;}
    if(["shot","hit","death","paint"].includes(event.type))log.push(`tick ${frame.snapshot.tick} · ${event.type}${event.weaponId?` / ${event.weaponId}`:""}${event.amount?` / ${event.amount.toFixed(1)}伤害`:""}${event.targetId?` → ${event.targetId}`:""}`);
  }
  log=log.slice(-12);
}
function step(){
  presentationTime+=1/60;const frame=session.step();accept(frame);
  if((stop.value==="projectile"&&frame.snapshot.projectiles.length>0)||frame.events.some(e=>e.type===stop.value))paused=true;
  draw(1/60);
}
function reset(){
  paused=true;presentationTime=accumulator=0;totalShots=totalHits=totalDeaths=0;deathAt=null;log=[];
  session=new CombatReviewSession(weapon.value);renderer.resetSession(session.frame.snapshot);accept(session.frame);draw();
}
$("fire").onclick=()=>{renderer.unlockAudio();session.fireOnce();step();};
$("defeat").onclick=()=>{renderer.unlockAudio();session.fireUntilDefeated();paused=false;status();};
$("play").onclick=()=>{renderer.unlockAudio();paused=!paused;accumulator=0;status();};
$("step").onclick=()=>{paused=true;step();};
$("reset").onclick=reset;weapon.onchange=reset;camera.onchange=()=>draw();
function loop(now:number){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  if(!paused){accumulator+=dt*Number(speed.value);while(accumulator>=1/60&&!paused){accumulator-=1/60;step();}}
  raf=requestAnimationFrame(loop);
}
window.addEventListener("resize",()=>draw());
window.addEventListener("pagehide",()=>{cancelAnimationFrame(raf);renderer.dispose();},{once:true});
reset();raf=requestAnimationFrame(loop);
