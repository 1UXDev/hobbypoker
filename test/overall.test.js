import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
import {addBot} from '../bots.js';
import {restartSoloGame} from '../server.js';

const totals=g=>g.view('a').players.map(p=>p.overallDelta);
const last=g=>g.players.map(p=>p.lastHandDelta);
function headsUp(){const g=new Game();g.add('a','Alice');g.add('b','Bob');return g;}

test('overall win/loss accumulates completed net hands and conserves chips',()=>{
  const g=headsUp();assert.deepEqual(totals(g),[0,0]);
  g.start('a');g.act('a','fold');
  assert.deepEqual(last(g),[-10,10]);assert.deepEqual(totals(g),[-10,10]);
  g.start('a');g.act('b','fold');
  assert.deepEqual(last(g),[10,-10]);assert.deepEqual(totals(g),[0,0]);
  g.start('a');g.act('a','raise',100);g.act('b','fold');
  assert.deepEqual(last(g),[20,-20]);assert.deepEqual(totals(g),[20,-20]);
  assert.equal(totals(g).reduce((sum,n)=>sum+n,0),0);
  assert.deepEqual(g.players.map(p=>p.chips),[1020,980]);
});

test('posting blinds and placing live or pending bets does not change either completed-hand total',()=>{
  const g=headsUp();g.start('a');
  assert.deepEqual(totals(g),[0,0]);assert.deepEqual(last(g),[null,null]);
  g.act('a','fold');g.start('a');
  assert.deepEqual(totals(g),[-10,10]);assert.deepEqual(last(g),[-10,10]);
  g.act('b','raise',100, {deferProgress:true});
  assert.equal(g.view('a').actionPending,true);
  assert.deepEqual(totals(g),[-10,10]);assert.deepEqual(last(g),[-10,10]);
  g.advance();g.act('a','fold',undefined,{deferProgress:true});
  assert.deepEqual(totals(g),[-10,10]);
  g.advance();assert.deepEqual(totals(g),[-30,30]);assert.deepEqual(last(g),[-20,20]);
});

test('side-pot awards and unmatched refunds contribute only their net gain',()=>{
  const g=new Game();
  [50,100,200].forEach((total,i)=>{
    g.add(`p${i}`,`Player ${i}`);
    Object.assign(g.players[i],{chips:1000-total,total,handStart:1000,overallDelta:[10,-5,-5][i],cards:[{v:14-i,s:1},{v:14-i,s:2}]});
  });
  g.board=[{v:2,s:0},{v:3,s:1},{v:7,s:2},{v:9,s:3},{v:11,s:0}];g.dealer=0;g.showdown();
  assert.deepEqual(g.result.refunds,[{seat:2,name:'Player 2',amount:100}]);
  assert.deepEqual(last(g),[100,0,-100]);assert.deepEqual(totals(g),[110,-5,-105]);
  assert.equal(totals(g).reduce((sum,n)=>sum+n,0),0);
});

test('split-pot net results count odd chips without counting returned stakes as winnings',()=>{
  const g=new Game();
  [5,5,1].forEach((total,i)=>{
    g.add(`p${i}`,`Player ${i}`);
    Object.assign(g.players[i],{chips:1000-total,total,handStart:1000,folded:i===2,overallDelta:[12,-12,0][i],cards:[{v:8-i,s:1},{v:8-i,s:2}]});
  });
  g.board=[10,11,12,13,14].map(v=>({v,s:0}));g.dealer=0;g.showdown();
  assert.deepEqual(last(g),[0,1,-1]);assert.deepEqual(totals(g),[12,-11,-1]);
  assert.equal(totals(g).reduce((sum,n)=>sum+n,0),0);
});

test('missing legacy overall counters default to zero instead of producing NaN',()=>{
  const g=headsUp();for(const p of g.players)delete p.overallDelta;
  assert.deepEqual(totals(g),[0,0]);g.start('a');g.act('a','fold');
  assert.deepEqual(totals(g),[-10,10]);
});

test('new games and solo restarts reset overall counters even while fresh blinds are posted',()=>{
  const g=new Game();g.add('human','Alice');addBot(g,'bot-a');addBot(g,'bot-b');g.start('human');
  g.phase='finished';g.pendingAdvance=null;g.turn=-1;
  g.players.forEach((p,i)=>Object.assign(p,{chips:i?1500:0,overallDelta:i?500:-1000,lastHandDelta:i?500:-1000}));
  g.result={handId:g.handId,reason:'showdown',pot:3000,winners:[],refunds:[]};
  const fresh=restartSoloGame(g,'human');
  assert.deepEqual(fresh.players.map(p=>p.overallDelta),[0,0,0]);
  assert.deepEqual(fresh.view('human').players.map(p=>p.overallDelta),[0,0,0]);
  assert.ok(fresh.players.every(p=>p.lastHandDelta===null));
  assert.deepEqual(g.players.map(p=>p.overallDelta),[-1000,500,500]);
  assert.deepEqual(totals(headsUp()),[0,0]);
});
