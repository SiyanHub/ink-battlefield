import * as T from "three";
import type { WeaponDefinition } from "../shared/contracts";
import { part, shape as primitiveShape } from "./primitives";

// Metres; working end points down -Z. Ink is an accent on readable paper,
// graphite and hardware, rather than the colour of every structural part.
type V = [number, number, number];
const paper = 0xeee6d4, metal = 0x969d9b, dark = 0x424b50, wood = 0xb59a70;
// Keep material values legible before the paper pass. Shared primitives are
// intentionally almost monochrome; close weapons need a wider graphite range.
function shape(geometry:T.BufferGeometry,color=paper) {
  const group=primitiveShape(geometry,color);
  const mesh=group.children[0] as T.Mesh<T.BufferGeometry,T.MeshLambertMaterial>;
  mesh.material.color.setHex(color);
  mesh.material.color.lerp(new T.Color(0xc6bfae),.12);
  return group;
}
function box(w:number,h:number,d:number,color=paper) { return shape(new T.BoxGeometry(w,h,d),color); }
class Builder {
  readonly root = new T.Group();
  constructor(readonly color: number) {}
  add<O extends T.Object3D>(name: string, o: O, p: V = [0,0,0]): O {
    o.name = name; part(this.root,o,...p); return o;
  }
  block(name: string, size: V, p: V, color = paper) {
    return this.add(name,box(...size,color),p);
  }
  tube(name: string,r: number,length: number,p: V,color=metal,sides=12) {
    const o=this.add(name,shape(new T.CylinderGeometry(r,r,length,sides),color),p);
    o.rotation.x=Math.PI/2; return o;
  }
  cone(name: string,r: number,length: number,p: V,color: number,sides=8) {
    const o=this.add(name,shape(new T.ConeGeometry(r,length,sides),color),p);
    o.rotation.x=-Math.PI/2; return o;
  }
  profile(name: string,points: [number,number][],width: number,color=paper) {
    const path=new T.Shape(points.map(([z,y])=>new T.Vector2(z,y)));
    const geo=new T.ExtrudeGeometry(path,{depth:width,bevelEnabled:true,
      bevelSegments:1,steps:1,bevelSize:.002,bevelThickness:.002});
    geo.translate(0,0,-width/2); geo.rotateY(-Math.PI/2);
    return this.add(name,shape(geo,color));
  }
  contour(name:string,points:V[],color=dark) {
    const line=new T.Line(new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(...p))),
      new T.LineBasicMaterial({color,transparent:true,opacity:.58}));
    line.layers.set(1); return this.add(name,line);
  }
  anchors(grip:V,support?:V) {
    this.add("grip-anchor",new T.Object3D(),grip);
    this.root.userData.gripAnchor=[...grip];
    if(support) { this.add("support-anchor",new T.Object3D(),support); this.root.userData.supportAnchor=[...support]; }
  }
  link(name: string,a: V,b: V,r: number,color=metal) {
    const start=new T.Vector3(...a),end=new T.Vector3(...b),delta=end.clone().sub(start);
    const o=this.add(name,shape(new T.CylinderGeometry(r,r,delta.length(),8),color));
    o.position.copy(start.add(end).multiplyScalar(.5));
    o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()); return o;
  }
  muzzle(z: number,y=.025,r=.025) {
    this.tube("muzzle-rim",r,.035,[0,y,z+.0175],dark);
    this.add("bore",new T.Mesh(new T.CircleGeometry(r*.68,12),new T.MeshBasicMaterial({color:0x142b4b})),[0,y,z-.001]).rotation.y=Math.PI;
    this.add("muzzle",new T.Object3D(),[0,y,z-.006]);
  }
  grip() {
    this.profile("grip",[[.105,-.037],[.171,-.04],[.20,-.18],[.18,-.208],[.136,-.195],[.10,-.075]],.052,dark);
    for(const x of [-.028,.028]) this.contour("grip-seam",[[x,-.075,.127],[x,-.165,.16],[x,-.181,.177]],metal);
    const guard=this.add("trigger-guard",shape(new T.TorusGeometry(.036,.006,5,14),metal),[0,-.083,.065]);
    guard.rotation.y=Math.PI/2; guard.scale.set(1,.75,1);
    this.link("trigger",[0,-.05,.08],[0,-.085,.063],.005,dark);
  }
  stock(end=.42) {
    this.profile("stock",[[.15,.038],[.245,.032],[end-.03,.049],[end,.022],[end,-.113],[end-.032,-.127],[.26,-.072],[.19,-.042]],.057,wood);
    this.profile("butt-pad",[[end-.012,.025],[end+.009,.02],[end+.009,-.116],[end-.012,-.12]],.064,dark);
    for(const x of [-.03,.03]) this.contour("stock-inset",[[x,.015,.265],[x,.02,end-.035],[x,-.083,end-.035],[x,-.048,.27]],metal);
  }
  sights(front: number) {
    this.add("sight-anchor",new T.Object3D(),[0,.1115,.045]);
    this.block("rear-sight-base",[.065,.019,.04],[0,.069,.045],dark);
    for(const x of [-.022,.022]) this.block("rear-sight",[.008,.034,.016],[x,.089,.045],metal);
    this.block("front-sight-base",[.025,.04,.027],[0,.053,front],dark);
    this.block("front-sight",[.009,.049,.016],[0,.087,front],dark);
  }
}

function rifle(b: Builder,variant: "rifle"|"smg"|"carbine"|"lmg") {
  const smg=variant==="smg",lmg=variant==="lmg",carbine=variant==="carbine";
  const nose=smg?-.44:lmg?-.74:carbine?-.58:-.65;
  b.profile("receiver",smg?[[-.17,.045],[.145,.045],[.177,.013],[.145,-.051],[-.17,-.051]]:
    [[-.22,.052],[.12,.052],[.165,.029],[.176,-.007],[.12,-.056],[-.19,-.056],[-.24,-.025]],smg?.059:.072);
  b.block("ejection-port",[.004,.023,.092],[.04,.012,-.02],dark);
  b.link("charging-handle",[.036,.01,.075],[.067,.01,.075],.01,dark);
  b.profile("handguard",[[-.16,.037],[nose+.12,.034],[nose+.105,.011],[nose+.13,-.042],[-.18,-.048]],smg?.063:.07,carbine?wood:metal);
  for(let i=0;i<(smg?3:5);i++) for(const x of [-.037,.037])
    b.contour("vent",[[x,.013,-.22-i*(smg?.025:.047)],[x,.013,-.235-i*(smg?.025:.047)]],dark);
  b.tube("barrel",.014,.18,[0,.025,nose+.08],dark);
  b.muzzle(nose,.025,smg?.022:.025); b.grip();
  if(smg) {
    b.link("stock-strut",[-.022,.012,.15],[-.022,.012,.31],.011,metal);
    b.link("stock-strut",[.022,.012,.15],[.022,.012,.31],.011,metal);
    b.profile("butt-pad",[[.299,.029],[.325,.022],[.325,-.109],[.299,-.102]],.056,dark);
  } else b.stock(carbine?.365:.42);
  b.sights(nose+.16);
  b.block("ink-band",[.073,.005,.016],[0,.056,-.13],0x607f8b);
  for(const x of [-.038,.038]) b.contour("receiver-seam",[[x,.025,-.18],[x,.025,.085],[x,-.025,.115]],metal);
  if(lmg) {
    b.profile("magazine",[[-.185,-.049],[-.04,-.049],[-.04,-.195],[-.065,-.217],[-.18,-.207]],.14,wood);
    b.profile("feed-cover",[[-.22,.053],[.11,.053],[.07,.079],[-.19,.079]],.079,metal);
    for(let i=0;i<5;i++) b.tube("belt-round",.009,.065,[.047+i*.017,-.037,-.04],wood);
    for(const x of [-.06,.06]) b.link("folded-bipod",[x,0,-.46],[x,-.038,-.62],.007,dark);
  } else b.profile("magazine",smg?[[-.10,-.05],[-.045,-.05],[-.035,-.225],[-.087,-.228]]:
    [[-.145,-.05],[-.052,-.05],[-.06,carbine?-.16:-.205],[-.09,carbine?-.19:-.25],[-.165,carbine?-.17:-.23]],.047,dark);
  b.anchors([0,-.13,.155],[0,-.057,smg?-.25:lmg?-.38:-.34]);
}
function shotgun(b: Builder) {
  b.profile("receiver",[[-.22,.047],[.13,.047],[.18,.012],[.17,-.035],[.09,-.06],[-.22,-.049]],.066);
  b.stock(); b.grip();
  b.tube("barrel",.021,.54,[0,.03,-.46],dark);
  b.tube("magazine-tube",.022,.46,[0,-.028,-.40]);
  const pump=b.add("pump",shape(new T.CylinderGeometry(.043,.043,.19,12),wood),[0,-.022,-.39]);
  pump.rotation.x=Math.PI/2;
  for(let i=0;i<5;i++) {
    const ring=shape(new T.TorusGeometry(.043,.0018,3,12),dark);
    ring.rotation.x=Math.PI/2; part(pump,ring,0,(i-2)*.03,0);
  }
  b.block("ejection-port",[.004,.034,.11],[.037,0,-.01],dark);
  b.muzzle(-.74,.03,.028); b.sights(-.63);
  b.anchors([0,-.13,.155],[0,-.064,-.39]);
}
function revolver(b: Builder) {
  b.profile("frame",[[-.09,.068],[.115,.066],[.148,.001],[.07,-.048],[-.09,-.043]],.054);
  b.tube("barrel",.022,.25,[0,.035,-.21]);
  b.block("barrel-rib",[.032,.018,.30],[0,.063,-.18]);
  const drum=b.tube("cylinder",.053,.09,[0,.005,-.035],dark);
  for(let i=0;i<6;i++) {
    const a=i*Math.PI/3;
    part(drum,shape(new T.CylinderGeometry(.01,.01,.095,8),metal),Math.cos(a)*.039,0,Math.sin(a)*.039);
  }
  b.profile("grip",[[.07,-.025],[.14,-.024],[.20,-.18],[.17,-.215],[.097,-.19],[.055,-.07]],.055,wood);
  const guard=b.add("trigger-guard",shape(new T.TorusGeometry(.032,.006,5,14)),[0,-.07,.038]); guard.rotation.y=Math.PI/2;
  b.link("trigger",[0,-.04,.048],[0,-.075,.032],.004,dark);
  b.block("hammer",[.018,.034,.038],[0,.07,.11],dark).rotation.x=-.35;
  b.muzzle(-.35,.035,.026); b.sights(-.27);
  for(const x of [-.029,.029]) {
    const inset=b.profile("grip-panel",[[.094,-.064],[.125,-.052],[.17,-.17],[.149,-.184],[.108,-.165]],.004,0x8e785b);
    inset.position.x=x;
  }
  b.anchors([0,-.132,.13]);
}
function sniper(b: Builder) {
  b.profile("stock",[[.45,.023],[.16,.029],[.09,-.048],[-.36,-.038],[-.43,-.075],[.065,-.094],[.16,-.18],[.23,-.074],[.45,-.13]],.069,wood);
  b.block("butt-pad",[.073,.154,.018],[0,-.053,.45],dark);
  b.tube("receiver",.029,.31,[0,.034,-.025]);
  b.tube("barrel",.013,.65,[0,.034,-.5],dark); b.muzzle(-.85,.034,.023);
  b.block("magazine",[.05,.09,.079],[0,-.08,-.07],dark);
  for(const z of [-.13,.035]) b.block("scope-mount",[.034,.061,.025],[0,.087,z],dark);
  b.tube("scope",.028,.25,[0,.128,-.05],dark);
  b.tube("objective",.045,.078,[0,.128,-.209]);
  b.tube("eyepiece",.035,.046,[0,.128,.096]);
  b.tube("eyepiece-glass",.026,.003,[0,.128,.121],0x45768d);
  b.link("bolt",[.025,.032,.082],[.067,-.009,.082],.008,dark);
  b.add("bolt-knob",shape(new T.SphereGeometry(.016,10,6),dark),[.067,-.009,.082]);
  const guard=b.add("trigger-guard",shape(new T.TorusGeometry(.034,.005,5,16),dark),[0,-.099,.066]);
  guard.rotation.y=Math.PI/2;
  for(const x of [-.036,.036]) b.contour("stock-line",[[x,-.064,-.31],[x,-.071,.05],[x,-.107,.15],[x,-.039,.27],[x,-.04,.41]],dark);
  b.anchors([0,-.085,.145],[0,-.078,-.32]);
}
function grenade(b: Builder) {
  b.profile("receiver",[[-.15,.071],[.13,.071],[.17,.025],[.17,-.055],[.06,-.067],[-.15,-.07]],.067);
  b.grip(); b.stock(.35);
  b.tube("barrel",.045,.24,[0,.038,-.275]); b.muzzle(-.405,.038,.052);
  const drum=b.tube("cylinder",.096,.15,[0,-.042,-.08],dark);
  for(let i=0;i<6;i++) {
    const a=i*Math.PI/3;
    part(drum,shape(new T.CylinderGeometry(.027,.027,.155,10),paper),Math.cos(a)*.063,0,Math.sin(a)*.063);
  }
  b.sights(-.27);
  b.profile("foregrip",[[-.32,-.008],[-.20,-.008],[-.19,-.055],[-.31,-.055]],.073,wood);
  b.anchors([0,-.13,.155],[0,-.056,-.265]);
}
function pencil(b: Builder) {
  // Opus reference proportions: one continuous hexagonal pencil; no gun body.
  b.tube("shaft",.023,.49,[0,0,-.045],0xc5b583,6);
  b.cone("wood",.023,.075,[0,0,-.3275],wood,6);
  b.cone("graphite",.0085,.027,[0,0,-.370],dark,6);
  b.tube("ink-tip",.004,.006,[0,0,-.38],b.color,6);
  b.tube("ferrule",.025,.041,[0,0,.22]);
  for(const z of [.206,.22,.233]) b.tube("crimp",.026,.002,[0,0,z],dark);
  b.tube("eraser",.023,.042,[0,0,.261],0xcda39d);
  b.contour("stamp",[[.006,.021,.06],[.006,.021,-.035]],dark);
  b.add("muzzle",new T.Object3D(),[0,0,-.385]);
  b.anchors([0,0,.045]);
}
function brush(b: Builder) {
  const handle=b.add("lacquer-handle",shape(new T.LatheGeometry([new T.Vector2(.032,-.26),new T.Vector2(.025,-.1),new T.Vector2(.018,.17),new T.Vector2(.009,.23)],12),wood)); handle.rotation.x=Math.PI/2;
  b.tube("ferrule",.034,.085,[0,0,-.285]);
  const bristles=b.add("bristles",shape(new T.LatheGeometry([new T.Vector2(.001,-.505),new T.Vector2(.013,-.465),new T.Vector2(.029,-.415),new T.Vector2(.034,-.37),new T.Vector2(.031,-.327)],16),dark)); bristles.rotation.x=Math.PI/2;
  for(let i=0;i<6;i++) {
    const a=i*Math.PI/3;
    b.contour("bristle-line",[[Math.cos(a)*.032,Math.sin(a)*.032,-.335],[Math.cos(a)*.033,Math.sin(a)*.033,-.37],[Math.cos(a)*.027,Math.sin(a)*.027,-.416],[Math.cos(a)*.006,Math.sin(a)*.006,-.482]],metal);
  }
  b.tube("ferrule-seam",.0345,.005,[0,0,-.315],dark);
  b.add("muzzle",new T.Object3D(),[0,0,-.505]);
  b.anchors([0,0,.045]);
}
function pen(b: Builder) {
  b.tube("barrel",.022,.36,[0,0,.006],dark);
  const section=b.add("grip-section",shape(new T.LatheGeometry([new T.Vector2(.022,-.174),new T.Vector2(.017,-.235),new T.Vector2(.019,-.277)],12),0x666e6c)); section.rotation.x=Math.PI/2;
  for(const z of [-.171,-.276,.185]) b.tube("gold-band",.023,.006,[0,0,z],wood);
  const tail=b.add("rounded-tail",shape(new T.SphereGeometry(.022,12,8),dark),[0,0,.186]); tail.scale.z=.85;
  const nib=b.profile("nib",[[-.279,.014],[-.317,.021],[-.344,.017],[-.412,0],[-.344,-.017],[-.317,-.021],[-.279,-.014]],.003,0xc6a76b); nib.rotation.z=Math.PI/2;
  b.block("nib-slit",[.0015,.007,.091],[0,0,-.362],dark);
  b.contour("nib-engraving",[[.014,.004,-.308],[.011,.004,-.335],[.002,.004,-.376]],dark);
  b.link("clip",[.022,.001,.178],[.031,.001,.052],.003,wood);
  b.add("clip-tip",shape(new T.SphereGeometry(.0045,8,5),wood),[.031,.001,.052]);
  b.add("muzzle",new T.Object3D(),[0,0,-.414]);
  b.anchors([0,0,.045]);
}
function katana(b: Builder) {
  b.tube("wrapped-grip",.024,.22,[0,0,.04],dark,8);
  for(let i=0;i<7;i++) {
    const z=-.045+i*.027;
    b.contour("binding",[[-.019,.018,z-.013],[.019,.018,z+.013]],paper);
    b.contour("binding",[[.019,.018,z-.013],[-.019,.018,z+.013]],paper);
  }
  b.tube("pommel",.027,.018,[0,0,.157],wood);
  b.tube("guard",.064,.012,[0,0,-.082],metal,8);
  b.profile("blade",[[-.091,.024],[-.72,.034],[-.97,.018],[-1.045,-.001],[-.955,-.022],[-.7,-.011],[-.091,-.023]],.012);
  b.link("spine",[0,.026,-.095],[0,.033,-.72],.0025,metal);
  for(const x of [-.008,.008]) b.contour("blade-temper",[[x,-.014,-.10],[x,-.006,-.55],[x,.006,-.82],[x,.006,-.98]],metal);
  b.anchors([0,0,.045],[0,0,.125]);
}
function hammer(b: Builder) {
  b.tube("handle",.026,.65,[0,0,-.17],wood,6); b.tube("grip",.029,.19,[0,0,.03],dark,8);
  b.tube("pencil-head",.09,.36,[0,0,-.51],0xc5b583,6).rotation.set(0,0,Math.PI/2);
  b.tube("ferrule",.096,.035,[-.19,0,-.51]).rotation.set(0,0,Math.PI/2);
  b.tube("eraser",.09,.055,[-.235,0,-.51],0xcda39d).rotation.set(0,0,Math.PI/2);
  b.cone("wood-point",.09,.15,[.255,0,-.51],wood,6).rotation.set(0,0,-Math.PI/2);
  b.cone("graphite",.026,.052,[.344,0,-.51],dark,6).rotation.set(0,0,-Math.PI/2);
  b.tube("head-socket",.039,.067,[0,0,-.445],metal,8);
  b.tube("grip-end",.031,.012,[0,0,.13],wood,8);
  b.anchors([0,0,.045],[0,0,-.12]);
}
function compass(b: Builder) {
  b.tube("grip",.025,.12,[0,0,.13],dark,8);
  b.tube("hinge",.05,.036,[0,0,.035]).rotation.set(0,0,Math.PI/2);
  for(const side of [-1,1]) {
    const arm=b.profile("compass-arm",[[.018,.014],[-.39,.009],[-.39,-.009],[.018,-.014]],.025,metal);
    arm.position.x=side*.017; arm.rotation.y=-side*.28;
    b.link("point",[side*.13,0,-.39],[side*.151,0,-.5],.005,side<0?dark:b.color);
    b.tube("point-collar",.015,.035,[side*.129,0,-.383],dark,8).rotation.y=-side*.19;
  }
  b.link("adjustment-screw",[-.073,0,-.16],[.073,0,-.16],.004,dark);
  b.tube("adjustment-wheel",.025,.016,[0,0,-.16],dark).rotation.set(0,0,Math.PI/2);
  b.anchors([0,0,.13]);
}
function bow(b: Builder) {
  b.link("grip",[0,-.067,0],[0,.067,0],.025,wood);
  for(const side of [-1,1]) {
    b.profile("recurve-limb",[[.012,side*.045],[-.032,side*.17],[-.049,side*.29],[-.019,side*.38],[.048,side*.49],[.031,side*.49],[-.037,side*.39],[-.069,side*.29],[-.054,side*.165],[-.013,side*.045]],.027,wood);
    b.link("tip-binding",[0,side*.465,.032],[0,side*.49,.04],.017,dark);
  }
  b.add("bowstring",new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0,-.49,.04),new T.Vector3(.03,0,.14),new T.Vector3(0,.49,.04)]),new T.LineBasicMaterial({color:dark})));
  const arrow=new T.Group(); arrow.name="arrow"; b.root.add(arrow);
  const shaft=shape(new T.CylinderGeometry(.004,.004,.7,6),wood); shaft.rotation.x=Math.PI/2; part(arrow,shaft,.03,0,-.21);
  const tip=shape(new T.ConeGeometry(.013,.03,4),metal); tip.rotation.x=-Math.PI/2; part(arrow,tip,.03,0,-.575);
  for(const rot of [0,Math.PI/2]) part(arrow,box(.034,.003,.055,b.color),.03,0,.11).rotation.z=rot;
  b.anchors([0,0,0],[.03,0,.14]);
}
function roller(b: Builder) {
  b.tube("handle",.026,.23,[0,0,.035],dark);
  const framePath=new T.CatmullRomCurve3([[0,0,-.075],[0,0,-.25],[.03,0,-.30],[.16,0,-.30],[.19,0,-.33],[.19,0,-.46]].map(p=>new T.Vector3(...p as V)),false,"centripetal");
  b.add("frame",shape(new T.TubeGeometry(framePath,20,.006,6,false),metal));
  b.link("axle",[.19,0,-.46],[-.16,0,-.46],.007);
  b.tube("roller",.065,.3,[0,0,-.46],b.color,20).rotation.set(0,0,Math.PI/2);
  for(const x of [-.154,.154]) b.tube("end-cap",.046,.012,[x,0,-.46],paper).rotation.set(0,0,Math.PI/2);
  b.tube("handle-collar",.027,.02,[0,0,-.07],wood);
  b.anchors([0,0,.045]);
}
const builders: Record<string,(b: Builder)=>void> = {
  rifle:b=>rifle(b,"rifle"),smg:b=>rifle(b,"smg"),carbine:b=>rifle(b,"carbine"),lmg:b=>rifle(b,"lmg"),
  shotgun,revolver,sniper,grenade,pencil,brush,pen,katana,hammer,compass,bow,roller,
};
export function buildWeapon(w: WeaponDefinition) {
  const b=new Builder(w.color); (builders[w.model]??builders.rifle)(b); b.root.name=w.model; return b.root;
}
