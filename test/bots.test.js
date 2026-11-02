import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
import {decide,personalities,updateMoods} from '../bots.js';

function seeded(seed=42){return()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/2**32;};}
const marginal=[{v:10,s:0},{v:8,s:1}];
const trash=[{v:7,s:0},{v:2,s:1}];
const premium=[{v:14,s:0},{v:14,s:1}];
function fixture(style,{cards=marginal,current=20,pot=100,mood=0}={}){
  const game=new Game();game.add('bot','Bot');game.add('opponent','Opponent');
  Object.assign(game,{phase:'preflop',current,minRaise:20,dealer:1,turn:0});
  Object.assign(game.players[0],{bot:{...personalities.find(p=>p.style===style)},mood,cards:structuredClone(cards),chips:1000,total:0});
  game.players[1].total=pot;
  return game;
}
function sample(style,options={},count=4000){
  const game=fixture(style,options),random=seeded(),counts={fold:0,call:0,raise:0,allin:0};
  for(let hand=1;hand<=count;hand++){game.handId=hand;counts[decide(game,0,random).type]++;}
  return counts;
}

test('Rock mixes folds, calls and occasional raises with the same marginal hand',()=>{
  const counts=sample('Rock');
  assert.ok(counts.fold>2000&&counts.fold<3200,JSON.stringify(counts));
  assert.ok(counts.call>600,JSON.stringify(counts));
  assert.ok(counts.raise>10&&counts.raise<200,JSON.stringify(counts));
});

test('Rock remains materially tighter and less aggressive than LAG and Maniac',()=>{
  const rock=sample('Rock'),lag=sample('LAG · Loose-Aggressive'),maniac=sample('Maniac');
  assert.ok(rock.fold-lag.fold>1500);assert.ok(rock.fold-maniac.fold>1500);
  assert.ok(lag.raise>rock.raise*5);assert.ok(maniac.raise>lag.raise);
  const station=sample('Calling Station');assert.ok(station.call>lag.call);
  assert.ok(station.raise<lag.raise/4);
});

test('all personas value premium hands and usually fold trash to very large bets',()=>{
  for(const profile of personalities){
    const weak=sample(profile.style,{cards:trash,current:900,pot:1000},2000);
    const strong=sample(profile.style,{cards:premium,current:900,pot:1000},2000);
    assert.ok(weak.fold>1700,`${profile.style} weak ${JSON.stringify(weak)}`);
    assert.ok(strong.fold<100,`${profile.style} premium ${JSON.stringify(strong)}`);
    assert.ok(strong.call+strong.raise+strong.allin>weak.call+weak.raise+weak.allin);
  }
});

test('bots never fold when checking is free',()=>{
  for(const profile of personalities){
    const counts=sample(profile.style,{cards:trash,current:0,pot:100},500);
    assert.equal(counts.fold,0,profile.style);
    assert.equal(counts.call+counts.raise+counts.allin,500);
  }
});

test('hand style is private, bounded and stable within a hand but refreshed next hand',()=>{
  const game=fixture('Rock'),random=seeded();game.handId=10;
  decide(game,0,random);const hand=game.players[0].botHand;
  const snapshot=structuredClone(hand);
  decide(game,0,random);assert.equal(game.players[0].botHand,hand);
  assert.deepEqual(hand,snapshot);
  const variations=new Set();
  for(let i=11;i<100;i++){
    game.handId=i;decide(game,0,random);
    const next=game.players[0].botHand;
    assert.notEqual(next,hand);assert.equal(next.handId,i);
    assert.ok(Math.abs(next.looseness)<=.09);assert.ok(Math.abs(next.aggression)<=.08);
    assert.ok(Math.abs(next.bluff)<=.02);assert.ok(next.sizing>=.85&&next.sizing<=1.15);
    variations.add(next.looseness);
  }
  assert.equal(variations.size,89);
  const publicView=JSON.stringify(game.view('opponent'));
  assert.ok(!publicView.includes('botHand'));assert.ok(!publicView.includes('looseness'));
});

test('injected seeds reproduce choices regardless of hidden cards and deck',()=>{
  const a=fixture('TAG · Tight-Aggressive'),b=fixture('TAG · Tight-Aggressive');
  a.players[1].cards=premium;b.players[1].cards=trash;
  a.deck=premium;b.deck=trash;
  const randomA=seeded(123),randomB=seeded(123);
  for(let i=0;i<200;i++){
    a.handId=b.handId=i;
    assert.deepEqual(decide(a,0,randomA),decide(b,0,randomB));
  }
});

test('moods stay bounded, react to results and decay without a new win or loss',()=>{
  const game=fixture('Maniac'),player=game.players[0];player.handStart=1000;
  for(let i=0;i<100;i++){player.chips=900;updateMoods(game);assert.ok(player.mood>=-2&&player.mood<=2);}
  assert.equal(player.mood,-2);
  for(let i=0;i<100;i++){player.chips=1100;updateMoods(game);assert.ok(player.mood>=-2&&player.mood<=2);}
  assert.equal(player.mood,2);
  player.chips=1000;updateMoods(game);assert.equal(player.mood,1.3);
});

test('randomized bet sizes respect full raise limits, stack bounds and personality batches',()=>{
  for(const profile of personalities){
    const game=fixture(profile.style,{cards:premium,current:20,pot:500}),random=seeded();
    let raises=0;
    for(let i=0;i<500;i++){
      game.handId=i;
      const action=decide(game,0,random);
      if(action.type!=='raise')continue;
      raises++;
      assert.ok(Number.isSafeInteger(action.amount));assert.ok(action.amount>=40&&action.amount<=1000);
      assert.ok(action.amount%profile.batch===0||action.amount===40||action.amount===1000);
    }
    assert.ok(raises>0,profile.style);
  }
});

test('a short-stack value shove remains legal and closed raise rights prevent shoves',()=>{
  const g=new Game();g.add('bot','Bot');g.add('p1','Opponent');g.add('p2','Opponent2');
  g.players[0].chips=25;g.players[0].bot={...personalities[1]};g.players[0].mood=0;
  g.start('bot');g.players[0].cards=structuredClone(premium);
  const shove=decide(g,0,()=>.5);assert.equal(shove.type,'allin');
  assert.doesNotThrow(()=>g.act('bot',shove.type,shove.amount));assert.equal(g.current,25);
  const closed=fixture('Maniac',{cards:premium,current:30});
  Object.assign(closed.players[0],{acted:true,raiseBasis:20,bet:20,chips:980});
  assert.equal(closed.canRaise(closed.players[0]),false);
  const response=decide(closed,0,()=>.01);
  assert.ok(response.type==='call'||response.type==='fold');
});
