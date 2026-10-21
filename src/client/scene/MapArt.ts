import * as T from "three";
import type { MapDefinition, PaintSurface } from "../../shared/contracts";

type Drawing=(ctx:CanvasRenderingContext2D)=>void;
const graphite="#39352f", blue="#748fa4", wash="#ded8c9";

/** Flat illustration follows the existing collision/paint surfaces. No decorative blockers. */
export function addMapArt(root:T.Group,map:MapDefinition){
  const panel=(surface:PaintSurface,draw:Drawing)=>{
    const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=768;
    const c=canvas.getContext("2d")!;
    c.strokeStyle=graphite;c.fillStyle=graphite;c.lineWidth=5;c.lineCap="round";
    draw(c);
    const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;
    const mesh=new T.Mesh(new T.PlaneGeometry(surface.width,surface.height),new T.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,opacity:.95}));
    const u=new T.Vector3().copy(surface.u),v=new T.Vector3().copy(surface.v),n=new T.Vector3().copy(surface.normal);
    mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(u,v,n));
    mesh.position.copy(surface.center).addScaledVector(n,.004);mesh.layers.set(1);mesh.renderOrder=-1;root.add(mesh);
  };
  const line=(c:CanvasRenderingContext2D,x:number,y:number,x2:number,y2:number)=>{c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke();};
  const text=(c:CanvasRenderingContext2D,t:string,x:number,y:number,size=46)=>{c.font=`500 ${size}px "Patrick Hand", "Microsoft YaHei", sans-serif`;c.fillText(t,x,y);};
  const frame=(c:CanvasRenderingContext2D)=>{c.strokeRect(35,35,954,698);c.lineWidth=1;c.strokeRect(42,41,940,685);c.lineWidth=5;};
  const facade=(c:CanvasRenderingContext2D)=>{
    // Windows are drawn on solid walls; no painted door implying a route.
    c.fillStyle="#b0b7a9";c.globalAlpha=.22;c.fillRect(54,110,916,130);c.globalAlpha=1;
    text(c,"PAPER  /  折纸工坊",110,200,62);
    for(const x of [100,565]){
      c.fillStyle=wash;c.globalAlpha=.4;c.fillRect(x,305,350,310);c.globalAlpha=1;
      c.strokeRect(x,305,350,310);c.strokeRect(x-8,297,366,326);
      line(c,x+175,305,x+175,615);line(c,x,453,x+350,453);
      for(let i=0;i<4;i++){c.globalAlpha=.16;line(c,x+30+i*42,340,x+90+i*42,400);c.globalAlpha=1;}
      line(c,x-18,639,x+370,639);
    }
    c.setLineDash([18,12]);c.strokeStyle=blue;line(c,20,23,1000,745);c.setLineDash([]);c.strokeStyle=graphite;
    text(c,"fold here",760,706,32);
  };
  const blueprint=(c:CanvasRenderingContext2D,index:number)=>{
    frame(c);text(c,`STUDY ${String(index+1).padStart(2,"0")}`,80,128,66);
    c.strokeStyle=blue;c.globalAlpha=.6;
    for(let x=90;x<940;x+=80)line(c,x,210,x,640);
    for(let y=210;y<680;y+=80)line(c,90,y,930,y);
    c.globalAlpha=1;c.strokeStyle=graphite;c.lineWidth=4;
    c.strokeRect(170,280,580,280);c.strokeRect(210,240,580,280);
    for(const p of [[170,280],[750,280],[170,560],[750,560]])line(c,p[0],p[1],p[0]+40,p[1]-40);
    c.lineWidth=2;text(c,"构筑 / UNDER CONSTRUCTION",80,710,38);
  };
  const painting=(c:CanvasRenderingContext2D,index:number)=>{
    frame(c);c.strokeRect(100,80,824,560);
    c.fillStyle=["#c2b4a6","#aebcba","#c7bd94","#b9aec0"][index%4];c.globalAlpha=.5;
    c.beginPath();c.arc(670,250,105,0,Math.PI*2);c.fill();c.globalAlpha=1;
    c.strokeStyle=graphite;c.lineWidth=3;
    c.beginPath();c.moveTo(130,570);c.lineTo(345,250);c.lineTo(570,570);c.lineTo(725,390);c.lineTo(900,570);c.stroke();
    for(let i=0;i<16;i++){c.globalAlpha=.22;line(c,340+i*10,280+i*13,370+i*10,565);}
    c.globalAlpha=1;text(c,`No.${index+1}    未完成的风景`,110,704,42);
  };
  let index=0;
  for(const b of map.boxes){
    if(b.size.y<1||["ground","north","south","east","west"].includes(b.id))continue;
    const faces=map.surfaces.filter(s=>s.id.startsWith(b.id+":")&&Math.abs(s.normal.y)<.1);
    if(b.id.startsWith("house"))for(const face of faces)panel(face,facade);
    else if(b.id.startsWith("easel")){const i=index++;for(const face of faces.filter(f=>Math.abs(f.normal.z)>.5))panel(face,c=>painting(c,i));}
    else if(b.id.startsWith("cover")){const i=index++;for(const face of faces.filter(f=>Math.abs(f.normal.z)>.5))panel(face,c=>blueprint(c,i));}
    else if(b.id.startsWith("crate"))for(const face of faces)panel(face,c=>{frame(c);line(c,35,35,989,733);line(c,989,35,35,733);text(c,"↑  ↑",390,440,90);});
    else if(b.id.startsWith("kiosk"))for(const face of faces)panel(face,c=>{frame(c);text(c,"COLOUR / 颜料",100,255,75);for(let i=0;i<5;i++){c.fillStyle=["#b96f76","#a6b479","#679eaa","#b99e74","#9c85a6"][i];c.globalAlpha=.6;c.fillRect(110+i*165,340,120,200);}c.globalAlpha=1;});
    else if(b.id.startsWith("inkwell"))for(const face of faces)panel(face,c=>{frame(c);text(c,"INK",270,350,180);text(c,"水性彩墨 · 02",220,530,60);});
  }
  const floor=map.surfaces.find(s=>s.id==="ground:top");
  if(floor)panel(floor,c=>{
    c.globalAlpha=.30;c.strokeStyle=blue;c.lineWidth=1.2;
    const street=map.id==="street";
    if(street){
      for(const x of [400,624]){line(c,x,50,x,718);for(let y=50;y<720;y+=35)line(c,x-10,y,x+10,y);}
    }else{
      c.setLineDash([9,12]);c.strokeRect(100,78,824,612);line(c,512,35,512,733);c.setLineDash([]);
      for(let i=0;i<18;i++){const x=80+i*50;line(c,x,700,x,710+(i%2)*8);}
    }
    c.globalAlpha=.7;c.fillStyle=graphite;text(c,map.id==="construction"?"01 / NOTEBOOK":street?"02 / PAPER TOWN":"03 / ATELIER",90,670,28);
    c.globalAlpha=.24;text(c,"留白，等待你的颜色。",90,710,22);
  });
  // Boundary print is an illustration on the real wall, not an extra object.
  const back=map.surfaces.find(s=>s.id==="north:south");
  if(back)panel({...back,width:14,height:3.5},c=>{
    // Compensate for the wide wall print so letterforms retain their proportions.
    c.scale(1,3);c.fillStyle=graphite;text(c,map.name,90,105,80);
    text(c,["DRAW / BUILD / PLAY","FOLD / WANDER / PAINT","MAKE YOUR MARK"][map.chapter]??"MAKE YOUR MARK",95,153,23);
    c.strokeStyle=blue;line(c,95,177,930,177);text(c,`SKETCHBOOK    ${String(map.chapter+1).padStart(2,"0")}`,95,220,26);
  });
}
