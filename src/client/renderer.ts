import * as T from "three";
import {maps,weapons} from "../content";
import type {GameFrame,GameSnapshot,Profile} from "../shared/contracts";
import {WeaponView} from "./weapon-view";
import {SketchPipeline} from "./render/SketchPipeline";
import {WorldView} from "./scene/WorldView";
import {ActorView} from "./scene/ActorView";
import {CombatEffects} from "./scene/CombatEffects";
import {GameAudio} from "./scene/GameAudio";
import {dispose} from "./primitives";
import {aimingView} from "./presenter";

/** Scene composition only: map, entities, effects, sound and sketch pipeline
 * own their resources and consume serializable game state independently. */
export class Renderer {
  readonly renderer:T.WebGLRenderer;
  readonly scene=new T.Scene();
  readonly camera=new T.PerspectiveCamera(74,1,.04,170);
  readonly viewScene=new T.Scene();
  readonly viewCamera=new T.PerspectiveCamera(72,1,.02,6);
  readonly weaponView=new WeaponView();
  readonly gun=this.weaponView.root;
  private worldView:WorldView|null=null;
  private actorView=new ActorView();
  private effects=new CombatEffects();
  private pipeline:SketchPipeline;
  private audio:GameAudio;
  private clock=new T.Clock();
  private lastDraw=0;
  private lastTick=-1;
  private lastEvent=-1;
  private resizeListener=()=>this.resize();
  spectator:T.Vector3|null=null;
  secondary=false;
  aimMode: "hip" | "sights" | "scope" | "focus" = "hip";
  get mapId(){return this.worldView?.map.id??"";}
  get paint(){return this.worldView?.paint??null;}
  constructor(readonly canvas:HTMLCanvasElement,readonly settings:()=>Profile["settings"]){
    this.renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
    this.renderer.setClearColor(0xf2efe6);this.renderer.info.autoReset=false;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
    this.scene.fog=new T.Fog(0xf2efe6,28,105);
    this.camera.layers.enable(1);this.viewCamera.layers.enable(1);
    this.scene.add(new T.HemisphereLight(0xfff9e8,0x969086,1.1));
    const sun=new T.DirectionalLight(0xfff8e8,1.25);sun.position.set(-18,32,12);
    sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
    sun.shadow.camera.left=-36;sun.shadow.camera.right=36;sun.shadow.camera.top=36;sun.shadow.camera.bottom=-36;
    sun.shadow.camera.near=1;sun.shadow.camera.far=100;sun.shadow.bias=-.001;sun.shadow.normalBias=.03;
    this.scene.add(sun,this.actorView.root,this.effects.root);
    this.viewScene.add(new T.HemisphereLight(0xfff9ed,0x8d877d,2));
    const light=new T.DirectionalLight(0xffffff,1.1);light.position.set(-2,4,3);this.viewScene.add(light,this.gun);
    this.pipeline=new SketchPipeline(this.renderer);
    this.audio=new GameAudio(()=>this.settings().volume);
    this.resize();window.addEventListener("resize",this.resizeListener);
    this.loadMap("construction");
  }
  resize(){
    const quality=this.settings().quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,quality==="high"?1.5:quality==="medium"?1.25:1));
    this.renderer.setSize(innerWidth,innerHeight);
    this.camera.aspect=this.viewCamera.aspect=innerWidth/innerHeight;
    this.camera.updateProjectionMatrix();this.viewCamera.updateProjectionMatrix();
    this.pipeline.resize(innerWidth,innerHeight,this.renderer.getPixelRatio());
  }
  loadMap(id:string){
    if(this.mapId===id)return;
    const map=maps[id];if(!map)return;
    this.worldView?.dispose();this.worldView=new WorldView(map);this.scene.add(this.worldView.root);
    this.actorView.clear();this.effects.clear();
  }
  resetSession(s:GameSnapshot){
    this.loadMap(s.mapId);this.worldView!.threats.reset();
    this.worldView!.paint.reset();this.worldView!.paint.update(s.paint);
    this.actorView.clear();this.effects.clear();this.lastEvent=-1;this.lastTick=s.tick;
    this.spectator=null;
  }
  frame(frame:GameFrame,playerId:string){
    const s=frame.snapshot;
    if(s.tick<this.lastTick||s.mapId!==this.mapId)this.resetSession(s);
    this.lastTick=s.tick;this.worldView?.paint.update(s.paint);
    for(const event of frame.events){
      if(event.id<=this.lastEvent)continue;this.lastEvent=event.id;
      this.worldView?.threats.event(event,s);this.effects.event(event);
      this.actorView.event(event,s.time);
      const local=event.actorId===playerId;
      if(local&&event.type==="shot")this.weaponView.shot();
      this.audio.event(event,local);
    }
  }
  unlockAudio(){this.audio.unlock();}
  draw(s:GameSnapshot|null,playerId:string,yaw:number,pitch:number){
    const time=this.clock.getElapsedTime(),dt=Math.min(.05,Math.max(0,time-this.lastDraw));this.lastDraw=time;
    this.gun.visible=false;
    this.aimMode="hip";
    if(!s){
      this.camera.position.set(13+Math.sin(time*.025)*3,6.2,23);
      this.camera.lookAt(-3,1.5,-5);
      this.camera.fov=74;this.camera.updateProjectionMatrix();
      this.actorView.clear();this.worldView?.threats.reset();this.worldView?.objectives.update(null);
    }else{
      this.loadMap(s.mapId);this.worldView?.threats.update(s);this.worldView?.objectives.update(s);
      this.actorView.update(s,playerId);
      const p=s.actors.find(a=>a.id===playerId);
      if(p){
        this.camera.position.set(p.pos.x,p.pos.y+1.62,p.pos.z);
        this.camera.rotation.set(-pitch,yaw,0,"YXZ");
        const w=weapons[p.weaponId];
        const ammo=p.ammo[p.weaponId];
        const aim=aimingView(w,this.secondary,p.alive&&s.phase==="playing"&&!this.spectator&&(ammo?.reloadUntil??0)<=s.time);
        this.aimMode=aim.mode;
        this.camera.fov+=(aim.fov-this.camera.fov)*(this.settings().reduceMotion?1:1-Math.exp(-22*dt));
        this.camera.updateProjectionMatrix();
        if(w){
          this.weaponView.set(w);this.gun.visible=p.alive&&aim.mode!=="scope";
          this.weaponView.update({time,dt,
            reloadRemaining:Math.max(0,(ammo?.reloadUntil??0)-s.time),
            charge:ammo?.chargeStarted!=null?Math.min(1,(s.time-ammo.chargeStarted)/Math.max(.1,w.charge??1)):0,
            speed:Math.hypot(p.vel.x,p.vel.z),reduceMotion:this.settings().reduceMotion,aim:aim.mode!=="hip"});
        }
      }
    }
    if(this.spectator){
      this.camera.position.copy(this.spectator);this.camera.rotation.set(-pitch,yaw,0,"YXZ");
      this.camera.fov=74;this.camera.updateProjectionMatrix();this.gun.visible=false;
    }
    this.effects.update(s,dt);this.renderer.info.reset();
    this.pipeline.render(this.scene,this.camera,time,this.settings().reduceMotion);
    if(this.gun.visible){
      this.renderer.autoClear=false;this.renderer.clearDepth();
      this.renderer.render(this.viewScene,this.viewCamera);this.renderer.autoClear=true;
    }
  }
  dispose(){
    window.removeEventListener("resize",this.resizeListener);
    this.worldView?.dispose();this.actorView.clear();this.effects.dispose();
    dispose(this.gun);this.pipeline.dispose();this.audio.dispose();
    this.scene.traverse(o=>{if(o instanceof T.DirectionalLight)o.shadow.dispose();});
    this.renderer.dispose();
  }
}
