import { test } from "node:test";
import assert from "node:assert/strict";
import { PaintRaster } from "../src/client/paint-raster";
import type { PaintSurface, PaintCell } from "../src/shared/contracts";

const blue=0x1977bd,red=0xe05b35;
const surface:PaintSurface={id:"floor",boxId:"floor",center:{x:0,y:0,z:0},u:{x:1,y:0,z:0},v:{x:0,y:0,z:1},normal:{x:0,y:1,z:0},width:8,height:8,cellSize:1,scoring:true};

/** ImageData is computed by the real raster; this only transports its bytes like putImageData. */
function pixelContext(width:number,height:number){
  const pixels=new Uint8ClampedArray(width*height*4),writes:number[]=[],clears:number[]=[];
  let allocations=0;
  const ctx={
    createImageData(w:number,h:number){allocations++;return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},
    putImageData(image:ImageData,x:number,y:number,dx=0,dy=0,w=image.width,h=image.height){
      writes.push(w*h);
      for(let row=dy;row<dy+h;row++)for(let col=dx;col<dx+w;col++){
        if(x+col<0||x+col>=width||y+row<0||y+row>=height)continue;
        const from=(row*image.width+col)*4,to=((y+row)*width+x+col)*4;
        pixels.set(image.data.subarray(from,from+4),to);
      }
    },
    clearRect(x:number,y:number,w:number,h:number){clears.push(w*h);for(let row=y;row<y+h;row++)pixels.fill(0,(row*width+x)*4,(row*width+x+w)*4);},
  };
  return {ctx:ctx as unknown as CanvasRenderingContext2D,pixels,writes,clears,get allocations(){return allocations;},at(x:number,y:number){return [...pixels.slice((y*width+x)*4,(y*width+x)*4+4)];}};
}
function block(cols:number,left:number,top:number,right:number,bottom:number,color=blue):PaintCell[]{
  const cells:PaintCell[]=[];for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)cells.push([y*cols+x,color,color===blue?"blue":"red"]);return cells;
}
function render(cells:PaintCell[],s=surface,width=512,height=512){
  const image=pixelContext(width,height),raster=new PaintRaster(s,image.ctx,width,height);
  raster.apply({id:s.id,revision:1,cells});return {image,raster};
}

test("neighboring ink cells merge into an opaque continuous area without paper seams",()=>{
  const {image}=render(block(8,1,1,6,6));
  for(let y=128;y<384;y++)for(let x=128;x<384;x++){
    const [r,g,b,a]=image.at(x,y);
    assert.equal(a,255,`unexpected thin ink at ${x},${y}`);
    assert.ok(b>g&&g>r,"blue pigment must retain its hue");
  }
});

test("a newly overpainted cell keeps its color at its center even inside a different color field",()=>{
  const cells=block(8,1,1,6,6),{image,raster}=render(cells);
  const changed=cells.map(c=>c[0]===3*8+3?[c[0],red,"red"] as PaintCell:c);
  raster.apply({id:surface.id,revision:2,cells:changed});
  const [r,,b,a]=image.at(224,288);assert.equal(a,255);assert.ok(r>b*2,"new red ink must not be outvoted by neighboring blue cells");
  assert.deepEqual(image.pixels,render(changed).image.pixels);
});

test("incremental overpaint, removal, reorder and edge clipping exactly match fresh renders",()=>{
  const s={...surface,width:30,height:20,cellSize:.5},w=517,h=383;
  let cells=block(60,0,0,17,16);const {image,raster}=render(cells,s,w,h);
  const cases=[
    cells.map(c=>c[0]%7===0?[c[0],red,"red"] as PaintCell:c),
    cells.filter(c=>c[0]%5!==0),
    [[0,blue,"blue"],[59,red,"red"],[2399,blue,"blue"]] as PaintCell[],
    [],
  ];
  for(const [step,next] of cases.entries()){
    cells=next;raster.apply({id:s.id,revision:step+2,cells:[...next].reverse()});
    assert.deepEqual(image.pixels,render(next,s,w,h).image.pixels,`incremental case ${step}`);
  }
  assert.ok(image.pixels.every(value=>value===0));
});

test("one changed cell updates bounded pixel tiles and reuses its fixed image buffer",()=>{
  const s={...surface,width:128,height:128,cellSize:1},cells=block(128,0,0,127,127);
  const {image,raster}=render(cells,s);image.writes.length=0;image.clears.length=0;
  cells[65*128+65]=[65*128+65,red,"red"];
  raster.apply({id:s.id,revision:2,cells});
  assert.ok(image.writes.length>0);
  assert.ok(image.writes.reduce((a,b)=>a+b,0)<512*512/8,"one pixel neighborhood must not repaint the entire surface");
  assert.equal(image.clears.length,0,"tile uploads overwrite old pixels without a full surface clear");
  assert.equal(image.allocations,1,"the raster keeps one bounded tile buffer");
  image.writes.length=0;
  assert.equal(raster.apply({id:s.id,revision:3,cells}),false);
  assert.equal(image.writes.length,0);
});

test("clear removes every pixel and a new match has no previous color residue",()=>{
  const {image,raster}=render(block(8,1,1,6,6));assert.equal(raster.clear(),true);
  assert.ok(image.pixels.every(value=>value===0));assert.equal(raster.clear(),false);
  const cells:PaintCell[]=[[0,red,"red"],[63,blue,"blue"]];
  raster.apply({id:surface.id,revision:1,cells});assert.deepEqual(image.pixels,render(cells).image.pixels);
});
