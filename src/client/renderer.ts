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
import {withBattlefieldView} from "./render/BattlefieldCapture";
import {PracticeAnchorHint} from "./scene/PracticeAnchorHint";
import {CombatKick} from "./render/CombatKick";
export {withBattlefieldView} from "./render/BattlefieldCapture";
export {nearestPracticeAnchor} from "./scene/PracticeAnchorHint";

/** GPU budget is independent of display scaling; DOM overlays retain native resolution. */
export function renderBudget(quality:Profile["settings"]["quality"],dpr:number){
  const scale=quality==="low"?.72:quality==="high"?1.15:1;
  return {
    pixelRatio:Math.min(1.5,Math.max(.5,dpr)*scale),
    normalScale:quality==="low"?.5:quality==="high"?1:.75,
    shadows:quality!=="low",
    shadowSize:quality==="high"?1024:768,
  };
}

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
  private kick=new CombatKick();
  private practiceHint:PracticeAnchorHint|null=null;
  private pipeline:SketchPipeline;
  private audio:GameAudio;
  private sun:T.DirectionalLight;
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
    const sun=this.sun=new T.DirectionalLight(0xfff8e8,1.25);sun.position.set(-18,32,12);
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
    const budget=renderBudget(this.settings().quality,devicePixelRatio);
    this.renderer.setPixelRatio(budget.pixelRatio);
    this.renderer.shadowMap.enabled=budget.shadows;
    if(this.sun.shadow.mapSize.x!==budget.shadowSize){
      this.sun.shadow.map?.dispose();this.sun.shadow.map=null;
      this.sun.shadow.mapSize.setScalar(budget.shadowSize);
    }
    this.renderer.setSize(innerWidth,innerHeight);
    this.camera.aspect=this.viewCamera.aspect=innerWidth/innerHeight;
    this.camera.updateProjectionMatrix();this.viewCamera.updateProjectionMatrix();
    this.pipeline.resize(innerWidth,innerHeight,this.renderer.getPixelRatio(),budget.normalScale);
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
    this.kick.reset();
    this.practiceHint?.reset();
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
      if(local&&event.type==="grapple"&&s.modeId==="practice")this.practiceHint?.complete();
      if(local&&event.type==="shot"){
        const weapon=weapons[event.weaponId??""];
        if(weapon){this.weaponView.set(weapon);this.weaponView.shot(event.color);this.kick.shot(weapon);}
      }
      if(local&&(event.type==="hit"||event.type==="death")&&event.targetId!==playerId){
        this.kick.hit(event.type==="death");this.weaponView.impact(event.type==="death");
      }
      const player=s.actors.find(actor=>actor.id===playerId);
      this.audio.event(event,local,player?.pos,event.targetId===playerId);
    }
  }
  unlockAudio(){this.audio.unlock();}
  draw(s:GameSnapshot|null,playerId:string,yaw:number,pitch:number,presentation?:{time:number;dt:number}){
    const time=presentation?.time??this.clock.getElapsedTime(),dt=Math.min(.05,Math.max(0,presentation?.dt??time-this.lastDraw));this.lastDraw=time;
    this.gun.visible=false;
    this.aimMode="hip";
    const kick=this.kick.update(dt,this.settings().reduceMotion);
    if(!s){
      this.camera.position.set(13+Math.sin(time*.025)*3,6.2,23);
      this.camera.lookAt(-3,1.5,-5);
      this.camera.fov=74;this.camera.updateProjectionMatrix();
      this.actorView.clear();this.worldView?.threats.reset();this.worldView?.objectives.update(null);
    }else{
      this.loadMap(s.mapId);this.worldView?.threats.update(s);this.worldView?.objectives.update(s);
      this.actorView.update(s,playerId,dt);
      const p=s.actors.find(a=>a.id===playerId);
      if(p){
        this.camera.position.set(p.pos.x,p.pos.y+1.62,p.pos.z);
        this.camera.rotation.set(-pitch+kick.pitch,yaw,kick.roll,"YXZ");
        this.camera.translateZ(kick.push);
        const w=weapons[p.weaponId];
        const ammo=p.ammo[p.weaponId];
        const aim=aimingView(w,this.secondary,p.alive&&s.phase==="playing"&&!this.spectator&&(ammo?.reloadUntil??0)<=s.time);
        this.aimMode=aim.mode;
        this.camera.fov+=(aim.fov+kick.fov-this.camera.fov)*(this.settings().reduceMotion?1:1-Math.exp(-22*dt));
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
    if(s?.modeId==="practice"&&!this.practiceHint){this.practiceHint=new PracticeAnchorHint();this.scene.add(this.practiceHint.root);}
    this.practiceHint?.update(s,playerId,this.camera);
    this.effects.update(s,dt);this.renderer.info.reset();
    this.pipeline.render(this.scene,this.camera,time,this.settings().reduceMotion);
    if(this.gun.visible){
      this.renderer.autoClear=false;this.renderer.clearDepth();
      this.renderer.render(this.viewScene,this.viewCamera);this.renderer.autoClear=true;
    }
  }
  /** Export only local pixels; no upload, permanent GPU buffer or gameplay-state mutation. */
  async captureBattlefield(snapshot:GameSnapshot,options:{compare?:boolean}={}):Promise<Blob>{
    const world=this.worldView;
    if(!world||world.map.id!==snapshot.mapId)throw new Error("当前战场尚未载入，请稍后再留影。");
    const width=1440,height=900,compare=options.compare===true;
    const output=document.createElement("canvas");
    output.width=width*(compare?2:1);output.height=height+108;
    const ctx=output.getContext("2d");
    if(!ctx)throw new Error("浏览器无法创建留影画布。");
    ctx.fillStyle="#f2efe6";ctx.fillRect(0,0,output.width,output.height);
    const oldSize=this.renderer.getSize(new T.Vector2()),oldRatio=this.renderer.getPixelRatio();
    const oldFog=this.scene.fog;
    const quality=renderBudget(this.settings().quality,devicePixelRatio);
    const hidden=[this.actorView.root,this.effects.root,this.gun,world.objectives.root,...(this.practiceHint?[this.practiceHint.root]:[]),
      ...[...world.threats.warnings.values()].map(w=>w.group),...world.threats.marks.values()];
    const paint=[...world.paint.entries.values()].map(e=>e.mesh);
    let panel=0;
    try {
      this.renderer.setPixelRatio(1);this.renderer.setSize(width,height,false);
      this.pipeline.resize(width,height,1,1);
      // The overview camera is much higher than an FPS eye; distance fog must not wash out the page.
      this.scene.fog=null;
      withBattlefieldView(world.map,this.camera,hidden,paint,clean=>{
        this.pipeline.render(this.scene,this.camera,0,true,190);
        // Read the current drawing buffer in this task, before it can be cleared by the browser.
        ctx.drawImage(this.canvas,panel*width,0,width,height);
        ctx.fillStyle="#494941";ctx.font='25px "Patrick Hand",sans-serif';
        ctx.fillText(clean?"开局 · 留白画页":"本局 · 彩墨战场",panel*width+32,height+42);
        ctx.fillStyle="#77796f";ctx.font="18px sans-serif";
        ctx.fillText(`${world.map.name}  /  墨绘战场`,panel*width+32,height+76);
        panel++;
      },compare);
    } finally {
      this.scene.fog=oldFog;
      this.renderer.setPixelRatio(oldRatio);this.renderer.setSize(oldSize.x,oldSize.y,false);
      this.pipeline.resize(oldSize.x,oldSize.y,oldRatio,quality.normalScale);
      this.pipeline.render(this.scene,this.camera,this.clock.getElapsedTime(),this.settings().reduceMotion);
      if(this.gun.visible){this.renderer.autoClear=false;this.renderer.clearDepth();this.renderer.render(this.viewScene,this.viewCamera);this.renderer.autoClear=true;}
    }
    return new Promise((resolve,reject)=>output.toBlob(blob=>blob?resolve(blob):reject(new Error("留影编码失败，请重试。")),"image/png"));
  }
  dispose(){
    window.removeEventListener("resize",this.resizeListener);
    this.worldView?.dispose();this.actorView.clear();this.effects.dispose();this.practiceHint?.dispose();
    dispose(this.gun);this.pipeline.dispose();this.audio.dispose();
    this.scene.traverse(o=>{if(o instanceof T.DirectionalLight)o.shadow.dispose();});
    this.renderer.dispose();
  }
}
