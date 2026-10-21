import * as T from "three";
/** Deterministic paper grain and two independent graphite directions; local only. */
export function paperTextures() {
  let seed=77123;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const make=(size:number,pixel:(x:number,y:number)=>number[])=>{
    const c=document.createElement("canvas");c.width=c.height=size;
    const ctx=c.getContext("2d")!,img=ctx.createImageData(size,size);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)img.data.set([...pixel(x,y),255],(y*size+x)*4);
    ctx.putImageData(img,0,0);
    const texture=new T.CanvasTexture(c);texture.wrapS=texture.wrapT=T.RepeatWrapping;
    texture.colorSpace=T.NoColorSpace;return texture;
  };
  const paper=make(512,(x,y)=>{
    const n=(random()-.5)*11+Math.sin(x*.07)*Math.cos(y*.035)*1.5;
    return [246+n,243+n,235+n];
  });
  const widths=Array.from({length:64},()=>.45+random()*.4);
  const stroke=(across:number,along:number)=>{
    const i=Math.floor(across/8),index=((i%64)+64)%64;
    const distance=Math.abs(across/8-i-.5+Math.sin(along*Math.PI/256+index)*.045)*8;
    const weight=Math.max(0,Math.min(1,(widths[index]+.5-distance)));
    return weight*(.6+.4*Math.max(0,Math.sin(along*Math.PI/128+index*.7)))*255;
  };
  const hatch=make(512,(x,y)=>[stroke(x+y,x-y),stroke(x-y+512,x+y),0]);
  return {paper,hatch};
}
