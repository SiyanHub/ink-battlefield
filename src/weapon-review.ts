import * as T from "three";
import {weapons} from "./content";
import {buildWeapon} from "./client/weapons";
import {applyWeaponPaper} from "./client/render/WeaponPaper";
import {WeaponView} from "./client/weapon-view";
const canvas=document.querySelector("canvas")!;
const renderer=new T.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.setClearColor(0xf4f0e6);
const items=Object.values(weapons);
const weapon=document.querySelector<HTMLSelectElement>("#weapon")!;
weapon.innerHTML=items.map(w=>'<option value="'+w.id+'">'+w.name+'</option>').join("");
const mode=document.querySelector<HTMLSelectElement>("#view")!;
mode.querySelector('option[value="gallery"]')!.textContent=`${items.length} 件轮廓总览`;
const action=document.querySelector<HTMLSelectElement>("#action")!;
const labels=document.querySelector<HTMLElement>("#labels")!;
labels.innerHTML=items.map((w,i)=>'<span>'+String(i+1).padStart(2,"0")+' / '+w.name+'</span>').join("");
function light(s:T.Scene){s.add(new T.HemisphereLight(0xfff9ed,0x8d877d,2));const sun=new T.DirectionalLight(0xffffff,1.1);sun.position.set(-2,4,3);s.add(sun);}
const scenes=items.map(w=>{const s=new T.Scene();const model=buildWeapon(w);applyWeaponPaper(model);s.add(model);light(s);return s;});
const side=new T.PerspectiveCamera(36,1,.02,20);
// Side-biased three-quarter angle makes grips, stocks and connected nibs visible.
side.position.set(1.25,.6,.8); side.lookAt(0,0,-.18);
const first=new T.PerspectiveCamera(72,1,.02,6);
const view=new WeaponView(),scene=new T.Scene(); scene.add(view.root);light(scene);first.layers.enable(1);side.layers.enable(1);
const grid=new T.GridHelper(10,20,0xbfc7cd,0xd9daca); grid.position.y=-1.62; scene.add(grid);
const clock=new T.Clock(); let last=0,lastShot=-1;
function render() {
 const t=clock.getElapsedTime(),dt=Math.min(.05,t-last);last=t;
 const width=canvas.clientWidth,height=canvas.clientHeight;
 if(canvas.width!==Math.floor(width*renderer.getPixelRatio())||canvas.height!==Math.floor(height*renderer.getPixelRatio()))renderer.setSize(width,height,false);
 renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);renderer.clear();
 labels.style.display=mode.value==="gallery"?"grid":"none";
 document.querySelector<HTMLElement>("#cross")!.style.display=mode.value==="first"?"block":"none";
 if(mode.value==="gallery"){
  renderer.setScissorTest(true);
  const columns=Math.max(1,Math.round(Math.sqrt(items.length*width/height*.75))),rows=Math.ceil(items.length/columns);
  labels.style.gridTemplateColumns=`repeat(${columns},1fr)`;labels.style.gridTemplateRows=`repeat(${rows},1fr)`;
  const cellW=width/columns,cellH=height/rows;side.aspect=cellW/cellH;side.updateProjectionMatrix();
  scenes.forEach((s,i)=>{
   const x=(i%columns)*cellW,y=height-(Math.floor(i/columns)+1)*cellH;
   renderer.setViewport(x,y,cellW,cellH);renderer.setScissor(x,y,cellW,cellH);renderer.render(s,side);
  });
 }else{
  const w=weapons[weapon.value];view.set(w);
  const cycle=t%2.6;
  if(action.value==="fire"&&t-lastShot>.85){view.shot();lastShot=t;}
  view.update({time:t,dt,reloadRemaining:action.value==="reload"?Math.max(0,2-cycle):0,charge:action.value==="charge"?Math.min(1,cycle):0,speed:0,reduceMotion:true,aim:false});
  first.aspect=width/height;first.updateProjectionMatrix();renderer.render(scene,first);
 }
 document.querySelector("#resources")!.textContent=" 几何体 "+renderer.info.memory.geometries+" · 纹理 "+renderer.info.memory.textures;
 requestAnimationFrame(render);
}
render();
