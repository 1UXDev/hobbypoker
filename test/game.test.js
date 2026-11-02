import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game,rank,compare} from '../game.js';
import {addBot,decide,updateMoods,personalities} from '../bots.js';
import {server} from '../server.js';
const cards=(values,s=0)=>values.map(v=>({v,s}));
test('personas distinguish tight folds, sticky calls and value aggression',()=>{
 const g=new Game();g.add('h','Host');for(let i=0;i<6;i++)addBot(g,String(i));
 g.phase='preflop';g.board=[];g.current=100;g.minRaise=20;g.dealer=0;
 for(const p of g.players){p.cards=[{v:7,s:0},{v:2,s:1}];p.chips=900;p.bet=0;p.total=100;}
 assert.equal(decide(g,1,()=>.5).type,'fold');
 assert.equal(decide(g,4,()=>.5).type,'call');
 for(const p of g.players)p.cards=[{v:14,s:0},{v:14,s:1}];
 assert.equal(decide(g,2,()=>.5).type,'raise');
 assert.equal(decide(g,6,()=>.5).type,'call');
 assert.equal(new Set(personalities.map(p=>p.style)).size,6);
});
test('hand ranking: wheel, full house and best five out of seven',()=>{
 assert.equal(rank(cards([14,2,3,4,5]))[1],5);
 assert.equal(rank([...cards([14,14,14],0),...cards([13,13],1)])[0],6);
 assert.ok(compare(rank(cards([8,9,10,11,12,2,3])),rank(cards([2,3,4,5,6])))>0);
});
test('privacy, turn validation and complete heads-up hand',()=>{const g=new Game();g.add('a','A');g.add('b','B');g.start('a');assert.equal(g.turn,0);assert.deepEqual(g.view('a').players[1].cards,[null,null]);assert.throws(()=>g.act('b','call'));let actions=0;while(g.phase!=='finished'){g.act(g.players[g.turn].id,'call');assert.ok(++actions<20);}assert.equal(g.board.length,5);assert.equal(g.players.reduce((s,p)=>s+p.chips,0),2000);});
test('side pots conserve chips and award eligible players',()=>{const g=new Game();['a','b','c'].forEach(x=>g.add(x,x));g.board=[{v:2,s:0},{v:3,s:1},{v:7,s:2},{v:9,s:3},{v:11,s:0}];g.players.forEach((p,i)=>{p.chips=0;p.total=[50,100,100][i];p.cards=[{v:14-i,s:1},{v:14-i,s:2}];});g.showdown();assert.deepEqual(g.players.map(p=>p.chips),[150,100,0]);});
test('bot pool, mood and legal actions across 100 hands',()=>{const g=new Game();g.add('host','Host');for(let i=0;i<5;i++)addBot(g,String(i));for(let hand=0;hand<100;hand++){g.players.forEach(p=>p.chips=1000);g.start('host');let n=0;while(g.phase!=='finished'){const p=g.players[g.turn];const a=p.bot?decide(g,g.turn):{type:'call'};g.act(p.id,a.type,a.amount);assert.ok(++n<1000);}updateMoods(g);assert.equal(g.players.reduce((s,p)=>s+p.chips,0),6000);assert.ok(g.players.every(p=>p.chips>=0));}const p=g.players[1];p.handStart=100;p.chips=0;p.mood=0;updateMoods(g);assert.equal(p.mood,-1);});
test('HTTP room creation, joining, host authorization and live state',async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let stream;
 try{const post=async(path,data)=>{const r=await fetch(base+path,{method:'POST',body:JSON.stringify(data)});return {status:r.status,body:await r.json()};};const a=(await post('/join',{name:'Alice'})).body;const b=(await post('/join',{name:'Bob',room:a.room})).body;assert.equal((await post('/start',b)).status,400);assert.equal((await post('/bot',a)).status,200);stream=await fetch(`${base}/events?room=${a.room}&token=${a.token}`);const reader=stream.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/Alice/);assert.match(first,/Mara/);await reader.cancel();assert.equal((await post('/start',a)).status,200);assert.equal((await fetch(base)).status,200);for(const asset of ['/app.js','/cards.js','/bets.js','/poker.js','/equity.js','/equity-worker.js']){const response=await fetch(base+asset);assert.equal(response.status,200,asset);assert.match(response.headers.get('content-type'),/javascript/);}const css=await fetch(base+'/cards.css');assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/css/);assert.equal((await fetch(base+'/game.js')).status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
