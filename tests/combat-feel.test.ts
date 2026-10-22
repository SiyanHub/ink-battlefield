import test from "node:test";
import assert from "node:assert/strict";
import { CombatKick } from "../src/client/render/CombatKick";
import { weapons } from "../src/content";
import { BattleFeedback } from "../src/client/ui/feedback";
import { PracticeSession } from "../src/session/practice";
import { soundPalette, synthesizeSketch } from "../src/client/audio/Palette";
import { GameController } from "../src/client/ui/controller";
import { renderMenu } from "../src/client/ui/views";
import { renderHud } from "../src/client/ui/hud";
import { WeaponView } from "../src/client/weapon-view";
import { dispose } from "../src/client/primitives";

test("weapon kick is bounded during automatic fire, returns to neutral and respects reduced motion", () => {
  const kick = new CombatKick();
  for (let i = 0; i < 200; i++) { kick.shot(weapons.shotgun); kick.hit(true); }
  const sample = kick.update(0, false);
  assert.ok(sample.pitch > 0 && sample.pitch <= .042);
  assert.ok(Math.abs(sample.roll) <= .008 && sample.push <= .055);
  assert.deepEqual(kick.update(0, true), { pitch: 0, roll: 0, push: 0, fov: 0 });
  for (let i = 0; i < 120; i++) kick.update(1 / 60, false);
  assert.ok(kick.update(0, false).pitch < 1e-8);
  kick.shot(weapons.rifle); kick.reset();
  assert.deepEqual(kick.update(0, false), { pitch: 0, roll: 0, push: 0, fov: 0 });
});

test("hit feedback aggregates a close burst but never duplicates replayed damage", () => {
  const session = new PracticeSession({ classId: "heavy", autoStart: false });
  try {
    const snapshot = session.getSnapshot(), playerId = session.playerId;
    const feedback = new BattleFeedback();
    const events = [1, 2, 3].map(id => ({ id, type: "hit" as const, actorId: playerId, targetId: "paper-target", amount: 8 }));
    feedback.apply({snapshot, events}, playerId, 1);
    assert.equal(feedback.view(1).damage, 24);
    feedback.apply({snapshot, events}, playerId, 1.05);
    assert.equal(feedback.view(1.05).damage, 24);
    assert.equal(feedback.view(2).damage, 0);
    feedback.reset(); assert.equal(feedback.view(1).damage, 0);
  } finally { session.dispose(); }
});

test("a first shot or shot after a slow frame still presents its muzzle pulse and recoil", () => {
  const view=new WeaponView();
  try {
    view.set(weapons.rifle);
    const motion={time:12,dt:.05,reloadRemaining:0,charge:0,speed:0,reduceMotion:false,aim:false};
    view.update(motion);
    const idleZ=view.root.position.z;
    view.shot(0x1977bd);
    view.update({...motion,time:13});
    assert.equal(view.root.getObjectByName("ink-pulse")?.visible,true);
    assert.ok(view.root.position.z>idleZ,"the shot moves the weapon back on its first presented frame");
    view.update({...motion,time:13.2});
    assert.equal(view.root.getObjectByName("ink-pulse")?.visible,false);
  } finally { dispose(view.root); }
});

test("splash damage on a surviving target is not labeled as that target's kill", () => {
  const session=new PracticeSession({classId:"heavy",autoStart:false});
  try {
    const feedback=new BattleFeedback(),snapshot=session.getSnapshot(),actorId=session.playerId;
    feedback.apply({snapshot,events:[
      {id:1,type:"hit",actorId,targetId:"grunt",amount:70},
      {id:2,type:"death",actorId,targetId:"grunt"},
      {id:3,type:"hit",actorId,targetId:"brute",amount:7},
    ]},actorId,1);
    assert.equal(feedback.view(1).damage,7);
    assert.equal(feedback.view(1).lethal,true,"the actual kill still gets its crosshair and feed cue");
    assert.equal(feedback.view(1).damageLethal,false,"the surviving splash victim only received a hit");
    assert.match(renderHud(snapshot,actorId,false,feedback.view(1)),/7<small>命中<\/small>/);
  } finally {session.dispose();}
});

test("every equipped model has a bounded, audible synthesized shot and distinct impact cues", () => {
  for(const weapon of Object.values(weapons)){
    const sketch=soundPalette[weapon.model]; assert.ok(sketch,`${weapon.id} must not fire silently`);
    const samples=synthesizeSketch(sketch,24000,91);
    assert.ok(samples.length>500&&samples.length<24000);
    assert.ok(samples.some(sample=>Math.abs(sample)>.02));
    assert.ok(samples.every(sample=>Number.isFinite(sample)&&Math.abs(sample)<=.851));
    assert.equal(Math.abs(samples[0]),0);assert.equal(Math.abs(samples.at(-1)!),0);
  }
  assert.notDeepEqual(synthesizeSketch(soundPalette.hit,24000,91),synthesizeSketch(soundPalette.death,24000,91));
});

test("weapon rack exposes every primary and swaps a selected secondary without duplicating it", async () => {
  const game=new GameController();
  try{
    await game.action("practice");
    assert.match(renderMenu(game),/主武器速选/);
    assert.match(renderMenu(game),/data-id="dual"/);
    const before=[...game.state.loadout], second=before[1];
    await game.action("equip-primary",{id:second});
    assert.equal(game.state.loadout[0],second);assert.equal(game.state.loadout[1],before[0]);
    await game.action("equip-primary",{id:"rocket"});
    assert.equal(game.state.loadout[0],second,"another class cannot enter the loadout via the rack");
  }finally{game.leave();}
});
