import test from "node:test";
import assert from "node:assert/strict";
import * as rendering from "../src/client/renderer";
import * as warnings from "../src/client/threats";
import { maps } from "../src/content";
import * as T from "three";

test("three quality choices change render load even on a DPR=1 display", () => {
  const budget = Reflect.get(rendering, "renderBudget");
  assert.equal(typeof budget, "function", "Renderer exposes its hardware-independent quality budget");
  const low = budget("low", 1), medium = budget("medium", 1), high = budget("high", 1);
  assert.ok(low.pixelRatio < medium.pixelRatio && medium.pixelRatio < high.pixelRatio);
  assert.ok(low.normalScale < medium.normalScale && medium.normalScale <= high.normalScale);
  assert.equal(low.shadows, false);
  assert.equal(medium.shadows, true);
  assert.ok(budget("high", 4).pixelRatio <= 1.5, "retina displays keep a bounded GPU pixel budget");
});

test("battlefield comparison uses one camera and restores live paint and visibility even if capture fails", () => {
  const capture = Reflect.get(rendering, "withBattlefieldView");
  assert.equal(typeof capture, "function", "battlefield capture owns a reversible view transaction");
  const camera=new T.PerspectiveCamera(74,1.2,.04,170);
  camera.position.set(3,1.6,9);camera.rotation.set(.1,.2,.3);
  const original=camera.clone();
  const actor=new T.Group(),painted=new T.Group(),clean=new T.Group();clean.visible=false;
  const views:{clean:boolean;camera:number[];paint:boolean[]}[]=[];
  capture(maps.construction,camera,[actor],[painted,clean],(empty:boolean)=>{
    assert.equal(actor.visible,false);
    views.push({clean:empty,camera:camera.matrixWorldInverse.toArray(),paint:[painted.visible,clean.visible]});
  },true);
  assert.deepEqual(views.map(v=>v.clean),[true,false]);
  assert.deepEqual(views[0].camera,views[1].camera);
  assert.deepEqual(views.map(v=>v.paint),[[false,false],[true,false]]);
  assert.deepEqual(camera.position.toArray(),original.position.toArray());
  assert.deepEqual(camera.quaternion.toArray(),original.quaternion.toArray());
  assert.equal(camera.fov,original.fov);assert.equal(camera.aspect,original.aspect);
  assert.equal(actor.visible,true);assert.equal(painted.visible,true);assert.equal(clean.visible,false);
  assert.throws(()=>capture(maps.construction,camera,[actor],[painted],()=>{throw new Error("capture failed");},true),/capture failed/);
  assert.equal(actor.visible,true);assert.equal(painted.visible,true);
  assert.deepEqual(camera.position.toArray(),original.position.toArray());
});

test("ground warnings stay on the occupied floor below an actor instead of the base ground or an overhead deck", () => {
  const ground = Reflect.get(warnings, "warningGround");
  assert.equal(typeof ground, "function", "warning placement shares the collision world");
  const base = maps.construction;
  const map = { ...base, boxes: [
    { id: "ground", center: { x: 0, y: -.25, z: 0 }, size: { x: 30, y: .5, z: 30 } },
    { id: "deck", center: { x: 0, y: 3.75, z: 0 }, size: { x: 10, y: .5, z: 10 } },
  ] };
  assert.equal(ground(map, { x: 0, y: 4, z: 0 })?.y, 4.065);
  assert.equal(ground(map, { x: 0, y: 0, z: 0 })?.y, .065);
  assert.equal(ground(map, { x: 40, y: 0, z: 0 }), null, "do not invent warning floors outside geometry");
});

test("the practice grapple hint chooses the nearest unoccluded anchor within the actual reach", () => {
  const anchor = Reflect.get(rendering, "nearestPracticeAnchor");
  assert.equal(typeof anchor, "function", "practice hint uses reachable geometry");
  const map={...maps.construction,boxes:[{id:"wall",center:{x:0,y:3,z:-2},size:{x:5,y:6,z:.5}}],anchors:[
    {x:0,y:2,z:-3},{x:7,y:4,z:0},{x:40,y:4,z:0},
  ]};
  assert.deepEqual(anchor(map,{x:0,y:0,z:0}),map.anchors[1]);
  assert.equal(anchor({...map,anchors:[map.anchors[0],map.anchors[2]]},{x:0,y:0,z:0}),null);
});

test("battlefield exports keep every playable floor corner inside the fixed composition", () => {
  for(const map of Object.values(maps)){
    const camera=new T.PerspectiveCamera();
    rendering.withBattlefieldView(map,camera,[],[],()=>{
      for(const x of [-map.width/2,map.width/2])for(const z of [-map.depth/2,map.depth/2]){
        const point=new T.Vector3(x,0,z).project(camera);
        assert.ok(Math.abs(point.x)<.94&&Math.abs(point.y)<.94,`${map.id} floor corner must not be cropped: ${point.toArray()}`);
      }
    });
  }
});
