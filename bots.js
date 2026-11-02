import {randomInt} from 'node:crypto';
import {rank} from './game.js';
export const personalities=[
 {name:'Mara',style:'Nit',description:'Sehr enge Starthände. Gibt unter Druck früh auf und blufft kaum.',tightness:.95,aggression:.3,stickiness:.1,position:.3,aversion:.85,tilt:.1,rush:.1,batch:20,bluff:.02},
 {name:'Ada',style:'TAG · Tight-Aggressive',description:'Wählt ihre Hände aus und spielt gute Hände offensiv. Nutzt späte Position.',tightness:.75,aggression:.8,stickiness:.35,position:.9,aversion:.65,tilt:0,rush:0,batch:20,bluff:.13},
 {name:'Finn',style:'LAG · Loose-Aggressive',description:'Spielt viele Hände, stiehlt in später Position und setzt häufig unter Druck.',tightness:.25,aggression:.85,stickiness:.45,position:1,aversion:.35,tilt:.4,rush:1,batch:50,bluff:.28},
 {name:'Nora',style:'Calling Station',description:'Spielt viele Hände passiv. Callt auch mit schwachen Händen und raist selten.',tightness:.15,aggression:.08,stickiness:.95,position:.1,aversion:.45,tilt:.25,rush:.3,batch:20,bluff:.01},
 {name:'Leo',style:'Maniac',description:'Sehr weite Range, viele Raises und Bluffs. Nach Verlusten schnell auf Tilt.',tightness:.05,aggression:1,stickiness:.75,position:.2,aversion:.1,tilt:1,rush:.8,batch:100,bluff:.45},
 {name:'Ben',style:'Rock',description:'Bevorzugt starke Hände und kleine Pots. Verteidigt gelegentlich günstig oder blufft selektiv.',tightness:.9,aggression:.15,stickiness:.2,position:.2,aversion:.95,tilt:.05,rush:.05,batch:50,bluff:.01},
];
export function addBot(game,id){const b=personalities.find(x=>!game.players.some(p=>p.bot?.name===x.name));if(!b)throw Error('Alle KI-Persönlichkeiten sind bereits am Tisch.');game.add(id,b.name);Object.assign(game.players.at(-1),{bot:{...b},mood:0});}
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const sigmoid=value=>1/(1+Math.exp(-value));

// These are tendencies, not fixed action thresholds. Only own cards and public
// board/chip information enter the policy; a hand's bounded style offsets stay
// private and stable until the next hand while every decision gets fresh noise.
export function decide(game,index,random=()=>randomInt(1000000)/1000000){
 const p=game.players[index],b=p.bot;
 if(p.botHand?.handId!==game.handId){
  p.botHand={handId:game.handId,looseness:(random()-.5)*.18,
   aggression:(random()-.5)*.16,bluff:(random()-.5)*.04,sizing:.85+random()*.3};
 }
 const hand=p.botHand;
 let strength;
 if(game.board.length){const score=rank([...p.cards,...game.board]);strength=clamp(.15+score[0]*.13+(score[1]||0)/100,.05,.99);}
 else{const [a,c]=p.cards;strength=clamp((a.v+c.v)/38+(a.v===c.v?.23:0)+(a.s===c.s?.06:0)-(Math.abs(a.v-c.v)>4?.07:0),.05,.99);}
 const late=index===game.dealer||index===(game.dealer-1+game.players.length)%game.players.length;
 const positionBonus=late?b.position*.08:0;
 const mood=clamp(p.mood||0,-2,2),emotion=mood<0?-mood*b.tilt:mood*b.rush;
 const aggression=clamp(b.aggression+hand.aggression+emotion*.18,.03,.97);
 const cost=Math.min(p.chips,Math.max(0,game.current-p.bet));
 const pot=game.players.reduce((sum,q)=>sum+q.total,0);
 const potOdds=cost/Math.max(1,pot+cost),stackPressure=cost/Math.max(1,p.chips);
 const threshold=.20+b.tightness*.22+b.aversion*.12-b.stickiness*.28
  +potOdds*.65+stackPressure*.15-positionBonus-hand.looseness-emotion*.06;
 const perceived=strength+(random()-.5)*.10;
 // A smooth continuation curve avoids a Rock that folds every marginal hand.
 // Premium holdings have at most a 2% mistaken fold chance, never a hard fold
 // because an opponent made an oversized bet. Never fold when checking is free.
 const foldChance=clamp(sigmoid((threshold-perceived)*10),.005,strength>=.9?.02:.985);
 if(cost>0&&random()<foldChance)return {type:'fold'};
 const valueChance=sigmoid((perceived-(.57+b.tightness*.08))*12);
 const selectiveBluff=clamp(b.bluff+hand.bluff,.005,.5)*(cost===0?1.2:Math.max(.15,1-potOdds*2));
 const raiseChance=clamp(aggression*valueChance+selectiveBluff*(1-valueChance),.005,.95);
 const minimum=game.current+game.minRaise,maximum=p.bet+p.chips;
 if(game.canRaise(p)&&maximum>game.current&&random()<raiseChance){
  if(maximum<minimum)return {type:'allin'};
  const sizing=hand.sizing*(.85+random()*.3);
  const desired=Math.ceil((game.current+Math.max(game.minRaise,pot*(.3+aggression*.6))*sizing)/b.batch)*b.batch;
  return {type:'raise',amount:Math.min(maximum,Math.max(minimum,desired))};
 }
 return {type:'call'};
}
export function updateMoods(game){for(const p of game.players)if(p.bot){const delta=p.chips-(p.handStart??p.chips);p.mood=Math.max(-2,Math.min(2,(p.mood||0)*.65+(delta<0?-1:delta>0?1:0)));}}
