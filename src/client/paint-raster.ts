import type { PaintSurface, PaintSurfaceSnapshot } from "../shared/contracts";

const TILE=32,REACH=2.1;
function smooth(a:number,b:number,x:number){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
function hash(n:number){n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return (n^(n>>>16))>>>0;}

/** Four compact B-spline weights. Their sum is one: an interior never exposes a cell's outline. */
function axis(size:number,cell:number,flip=false){
  const base=new Int32Array(size),weights=new Float32Array(size*4),position=new Float32Array(size);
  const broad=new Float32Array(size),grain=new Float32Array(size),edge=new Float32Array(size);
  for(let i=0;i<size;i++){
    const p=(flip?size-i-.5:i+.5)/cell-.5,t=p-Math.floor(p),a=1-t;
    position[i]=p;base[i]=Math.floor(p)-1;
    weights.set([a*a*a/6,(3*t*t*t-6*t*t+4)/6,(-3*t*t*t+3*t*t+3*t+1)/6,t*t*t/6],i*4);
    broad[i]=Math.sin(p*.83+.7);grain[i]=Math.sin(p*2.37+1.4);edge[i]=Math.cos(p*5.13+.3);
  }
  return {base,weights,position,broad,grain,edge};
}

/** Logical cells are samples, not drawn decals. A compact continuous field produces opaque
 * pooled pigment. Every output pixel depends only on current neighbors and absolute coordinates,
 * so incremental and full renders are byte-identical, including removal and canvas edges. */
export class PaintRaster {
  private readonly cols:number;
  private readonly rows:number;
  private readonly cellX:number;
  private readonly cellY:number;
  private readonly tilesX:number;
  private readonly colors:Int32Array;
  private readonly seen:Uint32Array;
  private readonly active=new Set<number>();
  private generation=0;
  private readonly xAxis:ReturnType<typeof axis>;
  private readonly yAxis:ReturnType<typeof axis>;
  private readonly tile:ImageData;
  private readonly voteColors=new Int32Array(16);
  private readonly votes=new Float64Array(16);
  private readonly drops:Float32Array;
  private readonly seed:number;
  constructor(private readonly surface:PaintSurface,private readonly ctx:CanvasRenderingContext2D,private readonly width:number,private readonly height:number){
    this.cols=Math.ceil(surface.width/surface.cellSize);this.rows=Math.ceil(surface.height/surface.cellSize);
    this.cellX=surface.cellSize*width/surface.width;this.cellY=surface.cellSize*height/surface.height;
    this.tilesX=Math.ceil(width/TILE);
    this.colors=new Int32Array(this.cols*this.rows);this.colors.fill(-1);this.seen=new Uint32Array(this.colors.length);
    this.xAxis=axis(width,this.cellX);this.yAxis=axis(height,this.cellY,true);
    this.tile=ctx.createImageData(TILE,TILE);
    this.ctx.clearRect(0,0,width,height);
    this.seed=[...surface.id].reduce((h,c)=>Math.imul(h,31)+c.charCodeAt(0),17)>>>0;
    this.drops=new Float32Array(this.colors.length*3);
    for(let i=0;i<this.colors.length;i++){
      const n=hash(i^this.seed);if(n%7)continue;
      const angle=(n&65535)/65535*Math.PI*2,reach=1.05+((n>>>16)&255)/255*.3;
      this.drops[i*3]=Math.cos(angle)*reach;this.drops[i*3+1]=Math.sin(angle)*reach;
      this.drops[i*3+2]=.055+((n>>>24)&255)/255*.065;
    }
  }
  clear():boolean {
    if(!this.active.size)return false;
    this.ctx.clearRect(0,0,this.width,this.height);this.colors.fill(-1);this.active.clear();this.seen.fill(0);this.generation=0;return true;
  }
  apply(snapshot:PaintSurfaceSnapshot):boolean {
    if(++this.generation>=0xffffffff){this.seen.fill(0);this.generation=1;}
    const dirty=new Set<number>();
    for(const [index,pigment] of snapshot.cells){
      if(!Number.isInteger(index)||index<0||index>=this.colors.length)continue;
      const color=pigment&0xffffff;this.seen[index]=this.generation;
      if(this.colors[index]!==color){this.colors[index]=color;this.mark(index,dirty);}
      this.active.add(index);
    }
    for(const index of this.active)if(this.seen[index]!==this.generation){this.colors[index]=-1;this.mark(index,dirty);this.active.delete(index);}
    for(const id of dirty)this.renderTile(id);
    return dirty.size>0;
  }
  private mark(index:number,dirty:Set<number>){
    const x=(index%this.cols+.5)*this.cellX,y=this.height-(Math.floor(index/this.cols)+.5)*this.cellY;
    const left=Math.max(0,Math.floor((x-REACH*this.cellX-1)/TILE)),right=Math.min(this.tilesX-1,Math.floor((x+REACH*this.cellX+1)/TILE));
    const top=Math.max(0,Math.floor((y-REACH*this.cellY-1)/TILE)),bottom=Math.min(Math.ceil(this.height/TILE)-1,Math.floor((y+REACH*this.cellY+1)/TILE));
    for(let row=top;row<=bottom;row++)for(let col=left;col<=right;col++)dirty.add(row*this.tilesX+col);
  }
  private renderTile(id:number){
    const left=id%this.tilesX*TILE,top=Math.floor(id/this.tilesX)*TILE,w=Math.min(TILE,this.width-left),h=Math.min(TILE,this.height-top);
    const data=this.tile.data;data.fill(0);
    const ax=this.xAxis,ay=this.yAxis,aa=Math.max(.009,.24*Math.max(1/this.cellX,1/this.cellY));
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=left+px,y=top+py,bx=ax.base[x],by=ay.base[y],u=ax.position[x],v=ay.position[y];
      let field=0,gx=0,gy=0,count=0,nearest=-1,strongest=0,totalVote=0;
      for(let j=0;j<4;j++){
        const row=by+j;if(row<0||row>=this.rows)continue;
        const wy=ay.weights[y*4+j];
        for(let i=0;i<4;i++){
          const col=bx+i;if(col<0||col>=this.cols)continue;
          const index=row*this.cols+col,color=this.colors[index];if(color<0)continue;
          const weight=ax.weights[x*4+i]*wy;field+=weight;gx+=weight*(col-u);gy+=weight*(row-v);
          // A narrower color kernel keeps every painted cell's center faithful to that cell,
          // even when one new red cell is surrounded by fifteen older blue samples.
          const vote=weight*weight;totalVote+=vote;
          if(weight>strongest){strongest=weight;nearest=index;}
          let slot=0;while(slot<count&&this.voteColors[slot]!==color)slot++;
          if(slot===count){this.voteColors[count]=color;this.votes[count++]=vote;}else this.votes[slot]+=vote;
        }
      }
      if(!count)continue;
      const contour=ax.grain[x]*ay.edge[y]*.018+ax.edge[x]*ay.broad[y]*.012;
      const threshold=.185+contour;
      let alpha=smooth(threshold-aa,threshold+aa,field),color=0,best=-1;
      for(let i=0;i<count;i++)if(this.votes[i]>best){best=this.votes[i];color=this.voteColors[i];}
      let shade=1;
      if(alpha===0){
        const radius=this.drops[nearest*3+2];if(!radius)continue;
        const dx=u-(nearest%this.cols)-this.drops[nearest*3],dy=v-Math.floor(nearest/this.cols)-this.drops[nearest*3+1];
        const distance=Math.hypot(dx,dy),feather=.5*Math.max(1/this.cellX,1/this.cellY);
        alpha=1-smooth(radius-feather,radius+feather,distance);if(alpha<=0)continue;
        color=this.colors[nearest];shade=.86+.08*(1-Math.min(1,distance/radius));
      }else{
        const rim=1-smooth(threshold+.015,threshold+.13,field);
        const light=Math.max(0,(gx-gy)/Math.max(.001,Math.hypot(gx,gy)));
        const lip=smooth(threshold+.035,threshold+.09,field)*(1-smooth(threshold+.13,threshold+.28,field));
        const colorSeam=count>1?(1-smooth(.49,.72,best/Math.max(.00001,totalVote)))*.10:0;
        shade=.96-rim*.25+lip*light*.16-colorSeam;
      }
      const pigment=.023*ax.broad[x]*ay.grain[y]+.012*ax.grain[x]*ay.broad[y];
      const fleck=((hash(Math.imul(x+1,73856093)^Math.imul(y+1,19349663)^this.seed)&255)/255-.5)*.012;
      shade+=pigment+fleck;
      const p=(py*TILE+px)*4;
      data[p]=Math.min(255,((color>>>16)&255)*shade);data[p+1]=Math.min(255,((color>>>8)&255)*shade);data[p+2]=Math.min(255,(color&255)*shade);data[p+3]=Math.round(alpha*255);
    }
    this.ctx.putImageData(this.tile,left,top,0,0,w,h);
  }
}
