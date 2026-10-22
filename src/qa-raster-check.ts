import { PaintRaster } from "./client/paint-raster";
import type { PaintSurface, PaintCell } from "./shared/contracts";
import { teamInk } from "./shared/ink";

/** Compare the incremental path with a clean full draw using actual browser pixels. */
function checkBackend(willReadFrequently: boolean) {
  const surface: PaintSurface = {
    id: "pixel-check",
    boxId: "box",
    center: { x: 0, y: 0, z: 0 },
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 0, z: 1 },
    normal: { x: 0, y: 1, z: 0 },
    width: 20,
    height: 12,
    cellSize: 0.5,
    scoring: true,
  };
  const canvas = () => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 384;
    return c;
  };
  const actual = canvas(),
    reference = canvas();
  const ctx = actual.getContext("2d", { willReadFrequently })!,
    ref = reference.getContext("2d", { willReadFrequently })!;
  const raster = new PaintRaster(surface, ctx, 512, 384);
  let cells: PaintCell[] = Array.from({ length: 960 }, (_, i) => [
    i,
    i % 2 ? 0xe85b87 : 0x44bda7,
    "qa",
  ]);
  const result: object[] = [];
  function compare(name: string) {
    const snapshot = { id: surface.id, revision: result.length + 1, cells };
    raster.apply(snapshot);
    new PaintRaster(surface, ref, 512, 384).apply(snapshot);
    const a = ctx.getImageData(0, 0, 512, 384).data,
      b = ref.getImageData(0, 0, 512, 384).data;
    let differentPixels = 0,
      maxChannelError = 0,
      maxAlphaError = 0,
      maxPremultipliedError = 0;
    const examples: object[] = [];
    for (let i = 0; i < a.length; i += 4) {
      let different = false;
      for (let k = 0; k < 4; k++) {
        const d = Math.abs(a[i + k] - b[i + k]);
        maxChannelError = Math.max(maxChannelError, d);
        different ||= d > 0;
      }
      if (different) {
        differentPixels++;
        maxAlphaError = Math.max(maxAlphaError, Math.abs(a[i + 3] - b[i + 3]));
        for (let k = 0; k < 3; k++)
          maxPremultipliedError = Math.max(
            maxPremultipliedError,
            Math.abs(a[i + k] * a[i + 3] - b[i + k] * b[i + 3]) / 255,
          );
        if (examples.length < 8)
          examples.push({
            x: (i / 4) % 512,
            y: Math.floor(i / 4 / 512),
            a: [...a.slice(i, i + 4)],
            b: [...b.slice(i, i + 4)],
          });
      }
    }
    result.push({
      willReadFrequently,
      name,
      differentPixels,
      maxChannelError,
      maxAlphaError,
      maxPremultipliedError,
      examples,
      pass: differentPixels === 0,
    });
  }
  compare("initial full paint");
  cells = cells.map((c) => (c[0] % 17 === 0 ? [c[0], 0xe9b13b, "new"] : c));
  compare("overpaint across tile boundaries");
  cells = cells.filter((c) => c[0] % 13 !== 0);
  compare("remove overlapping spots");
  raster.clear();
  cells = [];
  compare("reset to clean paper");
  cells = [
    [0, 0xff0000, "red"],
    [4, 0x0000ff, "blue"],
    [959, 0x44bda7, "green"],
  ];
  compare("new match and clipped canvas edges");
  cells=Array.from({length:24*14},(_,i)=>[(Math.floor(i/24)+4)*40+i%24+6,teamInk.blue.color,"blue"]);
  compare("continuous same-color sheet");
  const center=11*40+18;
  cells=cells.map(c=>c[0]===center?[c[0],teamInk.red.color,"red"]:c);
  compare("one new color cell inside an older ink sheet");
  cells=[...cells].reverse();
  compare("snapshot order does not change visible pigment");
  cells=cells.filter(c=>Math.abs(c[0]%40-18)>2||Math.abs(Math.floor(c[0]/40)-11)>2);
  compare("remove a patch without old color residue");
  return result;
}

export function checkPaintPixels() {
  return [...checkBackend(true), ...checkBackend(false)];
}

/** Independent browser-pixel acceptance for merged opacity and minority-color fidelity. */
export function checkPaintMaterial(){
  const surface:PaintSurface={id:"oil-material",boxId:"floor",center:{x:0,y:0,z:0},u:{x:1,y:0,z:0},v:{x:0,y:0,z:1},normal:{x:0,y:1,z:0},width:8,height:8,cellSize:1,scoring:true};
  const canvas=document.createElement("canvas");canvas.width=canvas.height=512;
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!,raster=new PaintRaster(surface,ctx,512,512);
  let cells:PaintCell[]=[];for(let y=1;y<=6;y++)for(let x=1;x<=6;x++)cells.push([y*8+x,teamInk.blue.color,"blue"]);
  raster.apply({id:surface.id,revision:1,cells});
  const area=ctx.getImageData(128,128,256,256).data;
  let thinPixels=0;for(let i=3;i<area.length;i+=4)if(area[i]!==255)thinPixels++;
  cells=cells.map(c=>c[0]===27?[27,teamInk.red.color,"red"]:c);
  raster.apply({id:surface.id,revision:2,cells});
  const center=[...ctx.getImageData(224,288,1,1).data];
  return {name:"opaque merged oil and overpainted cell center",interiorPixels:65536,thinPixels,center,pass:thinPixels===0&&center[3]===255&&center[0]>center[2]*2};
}

/** CPU raster timing only. This does not claim WebGL upload time or game FPS. */
export function benchmarkPaintRaster(){
  const size=1024,surface:PaintSurface={id:"oil-benchmark",boxId:"floor",center:{x:0,y:0,z:0},u:{x:1,y:0,z:0},v:{x:0,y:0,z:1},normal:{x:0,y:1,z:0},width:48,height:48,cellSize:.55,scoring:true};
  const cols=Math.ceil(surface.width/surface.cellSize),rows=Math.ceil(surface.height/surface.cellSize);
  const canvas=document.createElement("canvas");canvas.width=canvas.height=size;
  const ctx=canvas.getContext("2d")!,put=ctx.putImageData.bind(ctx);
  let writes=0,pixels=0,revision=0;
  ctx.putImageData=(image:ImageData,x:number,y:number,dx?:number,dy?:number,w?:number,h?:number)=>{
    writes++;pixels+=(w??image.width)*(h??image.height);
    if(dx!==undefined&&dy!==undefined&&w!==undefined&&h!==undefined)put(image,x,y,dx,dy,w,h);else put(image,x,y);
  };
  const raster=new PaintRaster(surface,ctx,size,size),cells:PaintCell[]=[];
  const stats=(name:string,times:number[],uploadedPixels:number,uploads:number)=>{
    const sorted=[...times].sort((a,b)=>a-b),round=(n:number)=>Math.round(n*1000)/1000;
    return {name,steps:times.length,p50Ms:round(sorted[Math.floor(sorted.length*.5)]),p95Ms:round(sorted[Math.floor(sorted.length*.95)]),maxMs:round(sorted[sorted.length-1]),averageMs:round(times.reduce((a,b)=>a+b,0)/times.length),averageWrittenPixels:Math.round(uploadedPixels/times.length),uploads};
  };
  const results:ReturnType<typeof stats>[]=[];
  try {
    let times:number[]=[];writes=pixels=0;
    for(let step=0;step<120;step++){
      for(let n=0;n<1+step%10;n++){const index=cells.length;cells.push([index,teamInk.blue.color,"blue"]);}
      const start=performance.now();raster.apply({id:surface.id,revision:++revision,cells});times.push(performance.now()-start);
    }
    results.push(stats("grow 1–10 adjacent cells per step",times,pixels,writes));
    cells.length=0;for(let index=0;index<cols*rows;index++)cells.push([index,teamInk.blue.color,"blue"]);
    const fullStart=performance.now();raster.apply({id:surface.id,revision:++revision,cells});const fullFillMs=performance.now()-fullStart;
    for(const [name,count,spread] of [["one cell on full surface",1,false],["ten adjacent cells on full surface",10,false],["ten distributed cells on full surface",10,true],["unchanged full snapshot",0,false]] as const){
      times=[];writes=pixels=0;
      for(let step=0;step<100;step++){
        const base=(step*71+cols*5)%cells.length;
        for(let n=0;n<count;n++){
          const index=(base+n*(spread?317:1))%cells.length,color=cells[index][1]===teamInk.blue.color?teamInk.red.color:teamInk.blue.color;
          cells[index]=[index,color,color===teamInk.blue.color?"blue":"red"];
        }
        const start=performance.now();raster.apply({id:surface.id,revision:++revision,cells});times.push(performance.now()-start);
      }
      results.push(stats(name,times,pixels,writes));
    }
    return {cpuRasterOnly:true,texture:[size,size],cells:cells.length,fullFillMs:Math.round(fullFillMs*1000)/1000,results};
  }finally{ctx.putImageData=put;}
}
