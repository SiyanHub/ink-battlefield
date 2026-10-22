import * as T from "three";
import { PaintRaster } from "./client/paint-raster";
import { PaintView } from "./client/paint";
import { SketchPipeline } from "./client/render/SketchPipeline";
import { PaintField } from "./core/paint";
import { surfacesForBox } from "./content/maps";
import { teamInk } from "./shared/ink";
import type { BoxDefinition, PaintCell, PaintSurface } from "./shared/contracts";
import { benchmarkPaintRaster, checkPaintMaterial, checkPaintPixels } from "./qa-raster-check";

const blue=teamInk.blue.color,red=teamInk.red.color;
const flat:PaintSurface={id:"oil-review",boxId:"review",center:{x:0,y:0,z:0},u:{x:1,y:0,z:0},v:{x:0,y:0,z:1},normal:{x:0,y:1,z:0},width:16,height:12,cellSize:.5,scoring:true};
const canvas=(id:string)=>document.querySelector<HTMLCanvasElement>(`#${id}`)!;
const cards=["merged","overpaint","spots"].map(id=>{
  const c=canvas(id);return {id,raster:new PaintRaster(flat,c.getContext("2d")!,c.width,c.height),cells:new Map<number,PaintCell>()};
});
function ellipse(cells:Map<number,PaintCell>,cx:number,cy:number,rx:number,ry:number,color:number){
  for(let y=0;y<24;y++)for(let x=0;x<32;x++)if(((x-cx)/rx)**2+((y-cy)/ry)**2<1){const index=y*32+x;cells.set(index,[index,color,color===blue?"blue":"red"]);}
}
let revision=0;
function drawCards(){for(const card of cards)card.raster.apply({id:flat.id,revision:++revision,cells:[...card.cells.values()]});}
function resetCards(){
  for(const card of cards){card.cells.clear();card.raster.clear();}
  const [merged,overpaint,spots]=cards.map(c=>c.cells);
  ellipse(merged,12,12,9,6,blue);ellipse(merged,20,13,7,4.5,blue);ellipse(merged,10,8,6,4,blue);
  ellipse(overpaint,12,13,10,7,blue);ellipse(overpaint,22,10,6,5,red);overpaint.set(13*32+10,[13*32+10,red,"red"]);
  for(let i=0;i<6;i++)ellipse(spots,5+i*4,8+Math.sin(i)*3,2.1,2.3,blue);
  ellipse(spots,22,17,4,2.5,red);for(const [x,y,color] of [[4,18,blue],[9,17,blue],[14,19,red],[28,5,red]]){const index=y*32+x;spots.set(index,[index,color,color===blue?"blue":"red"]);}
  drawCards();
}

const worldCanvas=canvas("world"),renderer=new T.WebGLRenderer({canvas:worldCanvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;
const scene=new T.Scene();scene.background=new T.Color(0xf7f3e9);
const camera=new T.PerspectiveCamera(48,1,.05,100);camera.position.set(10,10,14);camera.lookAt(0,1,0);camera.layers.enable(1);
scene.add(new T.HemisphereLight(0xffffff,0x696a6a,2.3));const sun=new T.DirectionalLight(0xfff9e9,2.8);sun.position.set(-5,10,8);scene.add(sun);
const boxes:BoxDefinition[]=[
  {id:"floor",center:{x:0,y:-.15,z:0},size:{x:12,y:.3,z:10},scoring:true},
  {id:"wall",center:{x:0,y:2,z:-3.2},size:{x:10,y:4,z:.25}},
  {id:"deck",center:{x:3,y:1.85,z:1.6},size:{x:3.6,y:.3,z:3.4},scoring:true},
];
for(const b of boxes){
  const mesh=new T.Mesh(new T.BoxGeometry(b.size.x,b.size.y,b.size.z),new T.MeshStandardMaterial({color:0xe6e4de,roughness:1}));mesh.position.set(b.center.x,b.center.y,b.center.z);scene.add(mesh);
  const edges=new T.LineSegments(new T.EdgesGeometry(mesh.geometry),new T.LineBasicMaterial({color:0x737d84,transparent:true,opacity:.55}));mesh.add(edges);
}
const surfaces=boxes.flatMap(surfacesForBox),group=new T.Group();scene.add(group);
const view=new PaintView(group,surfaces),field=new PaintField(surfaces,boxes),pipeline=new SketchPipeline(renderer);
function drawWorld(){view.update(field.snapshot());pipeline.render(scene,camera,0,true);}
function resetWorld(){
  field.restore({revision:0,surfaces:[]});view.reset();
  field.stamp("floor:top",{x:-2,y:0,z:.8},2.8,"blue",blue);field.stamp("floor:top",{x:.5,y:0,z:2.2},1.8,"red",red);
  field.stamp("wall:south",{x:-1.6,y:2,z:-3},1.55,"blue",blue);field.stamp("wall:south",{x:.5,y:1.8,z:-3},1.1,"red",red);
  field.stamp("deck:top",{x:3,y:2,z:1.6},1.25,"blue",blue);drawWorld();
}
function resize(){const width=worldCanvas.clientWidth,height=worldCanvas.clientHeight;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();pipeline.resize(width,height,renderer.getPixelRatio());drawWorld();}
resetCards();resize();resetWorld();
window.addEventListener("resize",resize);
document.querySelector("#reset")!.addEventListener("click",()=>{resetCards();resetWorld();});
document.querySelector("#overcoat")!.addEventListener("click",()=>{
  ellipse(cards[0].cells,16,11,4,3,red);ellipse(cards[1].cells,13,17,3,2,red);drawCards();
  field.stamp("floor:top",{x:-1.5,y:0,z:1.5},1.3,"red",red);field.stamp("deck:top",{x:3.4,y:2,z:1.8},.75,"red",red);drawWorld();
});
const report=document.querySelector("#report")!,checks=document.querySelector("#checks")!;
document.querySelector("#verify")!.addEventListener("click",()=>{
  const pixels=checkPaintPixels() as {pass:boolean}[],material=checkPaintMaterial();
  checks.textContent=`像素一致性 ${pixels.filter(p=>p.pass).length}/${pixels.length} 通过 · 连续厚墨与覆色中心 ${material.pass?"通过":"失败"}`;
  report.textContent=JSON.stringify({pixels,material},null,2);
});
document.querySelector<HTMLButtonElement>("#benchmark")!.addEventListener("click",event=>{
  const button=event.currentTarget as HTMLButtonElement;button.disabled=true;report.textContent="测量中：1024² / 7744 格 / 渐增、单格、相邻十格、分散十格、静止快照。";
  // Let the status paint before the deliberately synchronous CPU benchmark.
  requestAnimationFrame(()=>setTimeout(()=>{try{report.textContent=JSON.stringify(benchmarkPaintRaster(),null,2);}finally{button.disabled=false;}},0));
});
window.addEventListener("pagehide",()=>{
  pipeline.dispose();scene.traverse(object=>{
    if(object instanceof T.Mesh||object instanceof T.LineSegments){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}
  });for(const entry of view.entries.values())entry.texture.dispose();renderer.dispose();
},{once:true});
