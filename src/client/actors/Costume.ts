import * as T from "three";
import type {ActorSnapshot} from "../../shared/contracts";
import {box,part,shape} from "../primitives";
import {cloth,dark,edge,form,paper,patch,plate,stroke} from "./PaperParts";

export function dressActor(body:T.Group,head:T.Group,a:ActorSnapshot,pigment:number,width:number){
  const role=a.kind==="player"?a.classId:a.enemyId;
  const human=a.kind==="player";
  // Ink on a flat facial plane stays readable at gameplay distance.
  for(const side of [-1,1]){
    const x=side*.065;
    stroke(head,[[x-.025,.035,-.171],[x+.025,.025,-.175]],edge,1);
    if(human){stroke(head,[[x-.026,.065,-.166],[x+.028,.062,-.166]],dark,.7);}
    else patch(head,.037,.017,x,.027,-.178,pigment).rotation.z=side*.20;
  }
  if(human){
    plate(head,[[-.016,.026,-.171],[.015,.026,-.171],[0,-.043,-.195]],cloth);
    stroke(head,[[-.03,-.093,-.146],[.025,-.091,-.146]],edge,.55);
    for(const side of [-1,1])part(head,form([[-.055,.018,.025],[.035,.019,.026]],cloth),side*.16,-.01,0);
  }else{
    stroke(head,[[0,.19,-.09],[0,.065,-.174],[0,-.08,-.168],[0,-.19,-.07]],dark,.6);
    stroke(head,[[-.04,-.08,-.169],[0,-.10,-.169],[.04,-.08,-.169]],edge,.85);
  }
  // Folded collar and torso seam, not detached strips floating before the chest.
  for(const side of [-1,1])plate(body,[[side*.035,1.3,-.09],[side*.18,1.24,-.15],[side*.07,1.11,-.164]],paper);
  stroke(body,[[0,.88,-.135],[0,1.12,-.17]],dark,.5);
  patch(body,.035,.19,-width*.53,1.12,-.167,pigment);
  part(body,form([[-.035,.225,.145],[.035,.225,.145]],dark),0,.81,0);
  part(body,box(.055,.05,.023,paper),0,.81,-.15);

  if(role==="heavy"||role==="brute"||role==="doodler"){
    for(const side of [-1,1]){
      const pad=part(body,form([[-.12,.15,.16],[.03,.19,.18],[.12,.11,.12]],cloth),side*(width+.03),1.23,0);pad.rotation.z=side*.2;
    }
    for(let i=0;i<3;i++)part(body,box(width*1.5,.095,.045,i%2?cloth:paper),0,1.14-i*.105,-.18-i*.003);
    part(head,form([[.02,.178,.166],[.15,.19,.16],[.24,.125,.12]],cloth),0,0,.015);
    patch(head,.27,.055,0,.038,-.182,dark);
    for(const side of [-1,1])patch(head,.068,.012,side*.075,.04,-.184,pigment);
    if(role==="doodler"){
      for(let i=0;i<5;i++){const p=part(body,box(.13,.63,.22,paper),(i-2)*.13,1.26,.18);p.rotation.z=(i-2)*.1;}
      for(const side of [-1,1])plate(body,[[side*.10,.86,-.19],[side*.32,.84,-.14],[side*.29,.53,-.12],[side*.13,.59,-.17]],cloth);
    }
  }else if(role==="scout"||role==="marksman"||role==="rusher"){
    // Hood-like folded cowl and an asymmetric cape; the face remains visible.
    part(head,form([[.02,.174,.163],[.18,.18,.17],[.25,.04,.07]],cloth,6),0,0,.035);
    plate(body,[[-.30,1.26,.03],[.22,1.25,.15],[.30,.64,.24],[-.25,.68,.28]],cloth);
    part(body,form([[-.06,.12,.13],[.04,.14,.14]],dark),0,1.34,0);
    if(role==="marksman")plate(head,[[-.06,.0,-.174],[.06,.0,-.174],[0,-.14,-.30]],paper);
    if(role==="rusher"){
      for(const side of [-1,1])plate(body,[[side*.18,1.1,.10],[side*.47,1.29,.16],[side*.28,.73,.12]],paper);
    }
  }else if(role==="artist"||role==="painter"||role==="maestro"){
    const beret=part(head,form([[.12,.17,.16],[.19,.21,.19],[.23,.13,.13]],cloth,10),-.025,0,0);beret.rotation.z=-.15;
    part(head,form([[0,.012,.012],[.045,.008,.008]],dark),-.025,.225,0);
    plate(body,[[-.14,1.23,-.174],[.14,1.23,-.174],[.21,.57,-.15],[-.21,.57,-.15]],paper);
    for(const side of [-1,1])stroke(body,[[side*.115,1.22,-.176],[side*.15,1.27,.10]],dark,.8);
    part(body,box(.18,.14,.026,cloth),0,.94,-.188);
    for(let i=0;i<3;i++){
      const brush=part(body,shape(new T.CylinderGeometry(.008,.009,.22+i*.025,6),dark),-.055+i*.05,1.04,-.213);brush.rotation.z=(i-1)*.14;
    }
    if(!human)for(const side of [-1,1]){
      part(body,form([[-.20,.10,.10],[.16,.10,.10],[.23,.06,.06]],paper),side*.18,1.06,.23);
      patch(body,.10,.12,side*.18,1.07,.333,pigment);
    }
    if(role==="maestro"){
      part(body,form([[.12,.28,.22],[.63,.23,.18],[.87,.20,.16]],cloth),0,0,.02);
      for(const side of [-1,1])plate(body,[[side*.08,1.25,.12],[side*.34,1.50,.20],[side*.39,.95,.15]],paper);
      for(const x of [-.12,0,.12])plate(head,[[x-.06,.18,0],[x,.39,.015],[x+.06,.18,0]],cloth);
    }
  }else if(role==="flyer"||role==="origami"){
    plate(head,[[-.09,.03,-.15],[.09,.03,-.15],[0,-.09,-.35]],paper);
    for(const side of [-1,1]){
      const wing=new T.Group();wing.name="wing"+side;part(body,wing,side*.16,1.19,.06);
      const span=role==="origami"?1.18:.85;
      plate(wing,[[0,0,0],[side*span,.38,.12],[side*span*.72,-.20,.18]],paper);
      plate(wing,[[0,0,0],[side*span*.72,-.20,.18],[side*.18,-.39,.03]],cloth);
      stroke(wing,[[0,0,.005],[side*span*.67,.10,.16],[side*span,.38,.12]],edge,.8);
      if(role==="origami")plate(wing,[[side*.15,-.2,.03],[side*.86,-.48,.17],[side*.45,-.18,.12]],paper);
    }
    plate(body,[[-.12,.82,.10],[.12,.82,.10],[0,.25,.46]],paper);
  }else{
    // Short helmet, vest pockets and shoulder strap distinguish the assault silhouette.
    part(head,form([[.10,.175,.16],[.20,.145,.13],[.23,.07,.07]],cloth),0,0,.01);
    part(head,box(.31,.027,.07,dark),0,.115,-.15);
    for(const side of [-1,1])part(body,form([[-.09,.075,.025],[.09,.075,.025]],cloth),side*.135,1.04,-.17);
    stroke(body,[[-.22,1.27,-.11],[.17,.85,-.15]],dark,.8);
    if(!human)plate(body,[[-.23,1.2,-.17],[.23,1.2,-.17],[0,.86,-.22]],paper);
  }
}
