import test from "node:test";
import assert from "node:assert/strict";
import * as review from "../src/dev/CombatReviewSession";

test("the combat review fires one real trigger and observes its travelling bullet before damage",()=>{
  const Session=Reflect.get(review,"CombatReviewSession");assert.equal(typeof Session,"function");
  const session=new Session("rifle");session.fireOnce();
  const first=session.step();
  assert.equal(first.events.filter((e:{type:string})=>e.type==="shot").length,1);
  assert.ok(first.snapshot.projectiles.length>0,"the real simulation exposes a bullet in flight");
  assert.equal(first.events.some((e:{type:string})=>e.type==="hit"),false,"a distant target is not hit on the trigger frame");
  let shots=1,hits=0;
  for(let i=0;i<90;i++){const frame=session.step();shots+=frame.events.filter((e:{type:string})=>e.type==="shot").length;hits+=frame.events.filter((e:{type:string})=>e.type==="hit").length;}
  assert.equal(shots,1);assert.ok(hits>0);
});

test("continuous review input stops on a real death and reset begins with clean authoritative state",()=>{
  const Session=Reflect.get(review,"CombatReviewSession");assert.equal(typeof Session,"function");
  const session=new Session("rifle");session.fireUntilDefeated();
  let death=false,frame=session.frame;
  for(let i=0;i<600&&!death;i++){frame=session.step();death=frame.events.some((e:{type:string})=>e.type==="death");}
  assert.equal(death,true,"ordinary input must eventually defeat the target");
  assert.equal(frame.snapshot.actors.find((a:{id:string})=>a.id===session.targetId)?.alive,false);
  let shots=0;for(let i=0;i<90;i++)shots+=session.step().events.filter((e:{type:string})=>e.type==="shot").length;
  assert.equal(shots,0);
  const fresh=new Session("rifle");assert.equal(fresh.frame.snapshot.projectiles.length,0);assert.equal(fresh.frame.snapshot.paint.surfaces.length,0);
});
