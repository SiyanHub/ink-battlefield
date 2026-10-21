import * as T from "three";
import { sketchFragment,sketchVertex } from "./sketch-shaders";
import { paperTextures } from "./PaperTextures";

/** The reference Opus technique: normal/depth outlines, graphite hatching,
 * paper grain, and chroma-preserved ink. Owns all render targets and textures. */
export class SketchPipeline {
  private normal=new T.WebGLRenderTarget(2,2);
  private color=new T.WebGLRenderTarget(2,2,{depthTexture:new T.DepthTexture(2,2,T.UnsignedIntType)});
  private textures=paperTextures();
  private normalMaterial=new T.MeshNormalMaterial();
  private quadScene=new T.Scene();
  private quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  private material=new T.ShaderMaterial({
    vertexShader:sketchVertex,fragmentShader:sketchFragment,depthTest:false,depthWrite:false,
    uniforms:{
      tScene:{value:this.color.texture},tNormal:{value:this.normal.texture},
      tDepth:{value:this.color.depthTexture},tPaper:{value:this.textures.paper},tHatch:{value:this.textures.hatch},
      uResolution:{value:new T.Vector2(2,2)},uNear:{value:.04},uFar:{value:170},
      uTime:{value:0},uBoil:{value:.18/1400},uBoilRate:{value:8},
      uPaperScale:{value:1.6},uHatchScale:{value:1},uEdgeDepth:{value:.8},
      uEdgeNormal:{value:.65},uEdgeFade:{value:95},uTone:{value:.42},
      uInkMin:{value:.22},uInkMax:{value:.42},uEnabled:{value:1},
      uPaperTint:{value:new T.Color(1,.998,.99)}
    }
  });
  private quad=new T.Mesh(new T.PlaneGeometry(2,2),this.material);
  constructor(private renderer:T.WebGLRenderer){this.quad.frustumCulled=false;this.quadScene.add(this.quad);}
  resize(width:number,height:number,pixelRatio:number) {
    const w=Math.max(2,Math.floor(width*pixelRatio)),h=Math.max(2,Math.floor(height*pixelRatio));
    this.normal.setSize(w,h);this.color.setSize(w,h);
    this.material.uniforms.uResolution.value.set(w,h);
    this.material.uniforms.uHatchScale.value=Math.max(1,pixelRatio);
  }
  render(scene:T.Scene,camera:T.PerspectiveCamera,time:number,reduceMotion:boolean) {
    const r=this.renderer,u=this.material.uniforms,mask=camera.layers.mask;
    u.uTime.value=time;u.uNear.value=camera.near;u.uFar.value=camera.far;u.uBoil.value=reduceMotion?0:.18/1400;
    const override=scene.overrideMaterial,fog=scene.fog;
    camera.layers.disable(1);scene.overrideMaterial=this.normalMaterial;scene.fog=null;
    r.setRenderTarget(this.normal);r.clear();r.render(scene,camera);
    scene.overrideMaterial=override;scene.fog=fog;camera.layers.mask=mask;
    r.setRenderTarget(this.color);r.clear();r.render(scene,camera);
    r.setRenderTarget(null);r.clear();r.render(this.quadScene,this.quadCamera);
  }
  dispose(){
    this.normal.dispose();this.color.depthTexture?.dispose();this.color.dispose();
    this.textures.paper.dispose();this.textures.hatch.dispose();this.normalMaterial.dispose();
    this.quad.geometry.dispose();this.material.dispose();
  }
}
