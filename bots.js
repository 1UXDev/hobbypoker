import {randomInt} from 'node:crypto';
import {rank} from './game.js';
export const personalities=[
 {name:'Mara',style:'Nit',description:'Sehr enge Starthände. Gibt unter Druck früh auf und blufft kaum.',tightness:.95,aggression:.3,stickiness:.1,position:.3,aversion:.85,tilt:.1,rush:.1,batch:20,bluff:.02},
 {name:'Ada',style:'TAG · Tight-Aggressive',description:'Wählt ihre Hände aus und spielt gute Hände offensiv. Nutzt späte Position.',tightness:.75,aggression:.8,stickiness:.35,position:.9,aversion:.65,tilt:0,rush:0,batch:20,bluff:.13},
 {name:'Finn',style:'LAG · Loose-Aggressive',description:'Spielt viele Hände, stiehlt in später Position und setzt häufig unter Druck.',tightness:.25,aggression:.85,stickiness:.45,position:1,aversion:.35,tilt:.4,rush:1,batch:50,bluff:.28},
 {name:'Nora',style:'Calling Station',description:'Spielt viele Hände passiv. Callt auch mit schwachen Händen und raist selten.',tightness:.15,aggression:.08,stickiness:.95,position:.1,aversion:.45,tilt:.25,rush:.3,batch:20,bluff:.01},
 {name:'Leo',style:'Maniac',description:'Sehr weite Range, viele Raises und Bluffs. Nach Verlusten schnell auf Tilt.',tightness:.05,aggression:1,stickiness:.75,position:.2,aversion:.1,tilt:1,rush:.8,batch:100,bluff:.45},
 {name:'Ben',style:'Rock',description:'Eng und passiv. Wartet auf starke Hände und spielt große Pots vorsichtig.',tightness:.9,aggression:.15,stickiness:.2,position:.2,aversion:.95,tilt:.05,rush:.05,batch:50,bluff:.01},
];
export function addBot(game,id){const b=personalities.find(x=>!game.players.some(p=>p.bot?.name===x.name));if(!b)throw Error('Alle KI-Persönlichkeiten sind bereits am Tisch.');game.add(id,b.name);Object.assign(game.players.at(-1),{bot:{...b},mood:0});}
// Policy uses only its own cards and public information.
export function decide(game,index,random=()=>randomInt(1000000)/1000000){
 const p=game.players[index],b=p.bot;let strength;
 if(game.board.length){const score=rank([...p.cards,...game.board]);strength=Math.min(.98,.15+score[0]*.13+(score[1]||0)/100);}else{const [a,c]=p.cards;strength=(a.v+c.v)/38+(a.v===c.v?.23:0)+(a.s===c.s?.06:0)-(Math.abs(a.v-c.v)>4?.07:0);}
 const late=index===game.dealer||index===(game.dealer-1+game.players.length)%game.players.length;
 const positionBonus=late?b.position*.08:0;
 const aggression=Math.max(0,Math.min(1,b.aggression+(p.mood<0?-p.mood*b.tilt:p.mood*b.rush)*.35));
 const cost=Math.max(0,game.current-p.bet),pot=game.players.reduce((s,q)=>s+q.total,0),pressure=cost/Math.max(1,pot+cost)+cost/Math.max(1,p.chips)*.3;
 const threshold=pressure+b.aversion*.2+b.tightness*(game.board.length? .12:.3)-b.stickiness*.25;
 if(cost>0&&strength+aggression*.1+positionBonus+random()*.1<threshold)return {type:'fold'};
 const minimum=game.current+game.minRaise;
 if(game.canRaise(p)&&p.chips+p.bet>=minimum&&(strength>.65+b.tightness*.1||random()<b.bluff+positionBonus)&&random()<aggression){const desired=Math.ceil((game.current+Math.max(game.minRaise,pot*(.3+aggression*.6)))/b.batch)*b.batch;return {type:'raise',amount:Math.min(p.chips+p.bet,Math.max(minimum,desired))};}
 if(game.canRaise(p)&&p.chips+p.bet>game.current&&p.chips+p.bet<minimum&&strength>.75&&random()<aggression)return {type:'allin'};
 return {type:'call'};
}
export function updateMoods(game){for(const p of game.players)if(p.bot){const delta=p.chips-(p.handStart??p.chips);p.mood=Math.max(-2,Math.min(2,(p.mood||0)*.65+(delta<0?-1:delta>0?1:0)));}}
