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
const raised=action=>action.target>action.currentBetBefore&&['raise','allin'].includes(action.type);

function opponentAdjustment(game,index,player){
 const actions=game.handLog?.actions;
 if(!Array.isArray(actions))return 0;
 const aggressor=actions.findLast(action=>action.seat!==index&&action.street===game.phase&&raised(action)&&!game.players[action.seat]?.folded);
 const read=aggressor&&player.botReads?.bySeat[aggressor.seat];
 if(!read)return 0;
 // Rare aggression gets more respect; a frequent large bettor gets less.
 // Evidence ramps in over five observed hands and never shifts the threshold
 // by more than six percentage points, preserving the bot's own archetype.
 const signal=clamp((read.raiseRate-.2)*2+(read.bigBetRate-.15),-1,1);
 return .06*signal*Math.min(1,read.hands/5);
}

function rememberPublicBets(game,index,player){
 const actions=game.handLog?.actions;
 if(game.phase!=='finished'||!Array.isArray(actions)||player.botReads?.handId===game.handId)return;
 const memory=player.botReads??{handId:null,bySeat:{}};
 for(let seat=0;seat<game.players.length;seat++){
  if(seat===index)continue;
  const moves=actions.filter(action=>action.seat===seat);
  if(!moves.length)continue;
  const raises=moves.filter(raised);
  const large=raises.filter(action=>action.amount/Math.max(20,action.potBefore)>=.65);
  const prior=memory.bySeat[seat];
  const smooth=(key,value)=>prior?prior[key]*.8+value*.2:value;
  memory.bySeat[seat]={hands:Math.min(20,(prior?.hands??0)+1),
   raiseRate:smooth('raiseRate',raises.length/moves.length),
   bigBetRate:smooth('bigBetRate',large.length/moves.length)};
 }
 memory.handId=game.handId;player.botReads=memory;
}


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
 const cost=Math.min(p.chips,Math.max(0,game.current-p.bet));
 const pot=game.players.reduce((sum,q)=>sum+q.total,0);
 const potOdds=cost/Math.max(1,pot+cost),stackPressure=cost/Math.max(1,p.chips);
 // Completed hands, rather than idle wall-clock time or lifetime handId, make
 // patient players gradually more willing to get involved. Protect short stacks:
 // only 20% of the impatience boost survives when a call costs the whole stack.
 const progress=clamp((p.stats?.handsPlayed??0)/24);
 const impatience=progress*(.04+b.tightness*.09)*(1-.8*stackPressure);
 const adjustment=opponentAdjustment(game,index,p);
 const aggression=clamp(b.aggression+hand.aggression+emotion*.18+impatience*.6,.03,.97);
 const threshold=.20+b.tightness*.22+b.aversion*.12-b.stickiness*.28
  +potOdds*.65+stackPressure*.15-positionBonus-hand.looseness-emotion*.06-impatience-adjustment;
 const perceived=strength+(random()-.5)*.10;
 // A smooth continuation curve avoids a Rock that folds every marginal hand.
 // Premium holdings have at most a 2% mistaken fold chance, never a hard fold
 // because an opponent made an oversized bet. Never fold when checking is free.
 const foldChance=clamp(sigmoid((threshold-perceived)*10),.005,strength>=.9?.02:.985);
 if(cost>0&&random()<foldChance)return {type:'fold'};
 const valueChance=sigmoid((perceived-(.57+b.tightness*.08))*12);
 const selectiveBluff=clamp(b.bluff+hand.bluff+impatience*.12,.005,.5)*(cost===0?1.2:Math.max(.15,1-potOdds*2));
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
export function updateMoods(game){
 for(const [index,p] of game.players.entries())if(p.bot){
  const delta=p.chips-(p.handStart??p.chips);
  p.mood=clamp((p.mood||0)*.65+(delta<0?-1:delta>0?1:0),-2,2);
  rememberPublicBets(game,index,p);
 }
}
