import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
import {addBot} from '../bots.js';
import {restartSoloGame} from '../server.js';

const playerToken = 'private-human-session-token';
const otherToken = 'private-opponent-session-token';
function headsUp() {
  const game=new Game();game.add(playerToken,'Alice');game.add(otherToken,'Bob');return game;
}
function callToEnd(game) {
  let moves=0;
  while(game.phase!=='finished') {
    assert.ok(++moves<100);
    game.act(game.players[game.turn].id,'call');
  }
}
const copy=value=>structuredClone(value);
const runout=[{v:11,s:0},{v:5,s:0},{v:9,s:3},{v:6,s:0},{v:7,s:2},{v:3,s:1},{v:2,s:0},{v:4,s:0}];

test('completed records preserve actual decisions and blind context but never appear mid-hand',()=>{
  const game=headsUp(),before=Date.now();game.start(playerToken);
  assert.equal(game.view(playerToken).completedHand,null);
  assert.equal(game.handLog.actions.length,0);
  assert.equal(game.matchStartedAt,game.handLog.startedAt);
  assert.ok(game.matchStartedAt>=before&&game.matchStartedAt<=Date.now());
  assert.deepEqual(game.handLog.blindPosts.map(({seat,type,amount,target,potBefore,pot,stackBefore,stackAfter})=>({seat,type,amount,target,potBefore,pot,stackBefore,stackAfter})),[
    {seat:0,type:'smallBlind',amount:10,target:10,potBefore:0,pot:10,stackBefore:1000,stackAfter:990},
    {seat:1,type:'bigBlind',amount:20,target:20,potBefore:10,pot:30,stackBefore:1000,stackAfter:980},
  ]);
  assert.throws(()=>game.act(otherToken,'call'));
  assert.throws(()=>game.act(playerToken,'raise',21));
  assert.equal(game.handLog.actions.length,0);
  game.act(playerToken,'raise',60,{deferProgress:true});
  assert.equal(game.view(playerToken).completedHand,null);
  const action=game.handLog.actions[0];
  assert.deepEqual(action,{sequence:1,seat:0,type:'raise',amount:50,target:60,allIn:false,
    street:'preflop',potBefore:30,pot:80,stackBefore:990,stackAfter:940,toCall:10,
    currentBetBefore:20,minRaiseBefore:20,board:[],at:action.at});
  game.advance();callToEnd(game);
  const record=game.view(playerToken).completedHand;
  assert.equal(record.schemaVersion,1);assert.equal(record.matchId,game.matchId);assert.equal(record.handId,1);
  assert.ok(record.endedAt>=record.startedAt);
  assert.deepEqual(record.board,game.board);assert.equal(record.board.length,5);
  assert.equal(record.actions.length,game.actionSequence);
  assert.deepEqual(record.actions.map(a=>a.sequence),record.actions.map((_,i)=>i+1));
  for(const move of record.actions){
    assert.equal(move.board.length,{preflop:0,flop:3,turn:4,river:5}[move.street]);
    assert.ok(move.at>=record.startedAt&&move.at<=record.endedAt);
    assert.equal(move.stackBefore-move.stackAfter,move.amount);
    assert.equal(move.pot-move.potBefore,move.amount);
  }
  assert.ok(record.actions.some(move=>move.type==='check'));
  assert.deepEqual(record.players.map(p=>[p.startingChips,p.endingChips,p.netChips]),game.players.map(p=>[p.handStart,p.chips,p.lastHandDelta]));
  const serialized=JSON.stringify(record);
  assert.ok(!serialized.includes(playerToken));assert.ok(!serialized.includes(otherToken));
  assert.ok(!serialized.includes('deck'));assert.ok(!serialized.includes('botHand'));
});

test('fold records reveal only the viewer cards, including folds on the river',()=>{
  for(const onRiver of [false,true]){
    const game=headsUp();game.start(playerToken);
    if(onRiver)while(game.phase!=='river')game.act(game.players[game.turn].id,'call');
    const folder=game.players[game.turn].id;
    game.act(folder,'fold');
    for(const [seat,player] of game.players.entries()){
      const record=game.view(player.id).completedHand;
      assert.equal(record.result.reason,'fold');
      assert.deepEqual(record.players[seat].holeCards,player.cards);
      assert.equal(record.players[seat].me,true);
      assert.deepEqual(record.players[1-seat].holeCards,[null,null]);
      assert.equal(record.players[1-seat].me,false);
    }
  }
});

test('showdown records expose live opponents but keep folded opponent cards unknown',()=>{
  const game=new Game();game.add('a','A');game.add('b','B');game.add('c','C');game.start('a');
  game.act('a','fold');callToEnd(game);
  const foldedViewer=game.view('a').completedHand;
  assert.ok(foldedViewer.players.every(p=>p.holeCards.every(Boolean)));
  const otherViewer=game.view('b').completedHand;
  assert.deepEqual(otherViewer.players[0].holeCards,[null,null]);
  assert.ok(otherViewer.players[1].holeCards.every(Boolean));
  assert.ok(otherViewer.players[2].holeCards.every(Boolean));
});

test('public records and stats are detached snapshots and new joiners do not alter a finished record',()=>{
  const game=headsUp();game.start(playerToken);game.act(playerToken,'fold');
  const first=game.view(playerToken),saved=copy(first.completedHand);
  first.completedHand.actions[0].amount=100000;
  first.completedHand.players[0].holeCards[0].v=99;
  first.stats={bogus:true};first.players[0].stats.wins=99;
  assert.deepEqual(game.view(playerToken).completedHand,saved);
  assert.equal(game.players[0].stats.wins,0);
  game.add('new-player','Cara');
  assert.equal(game.view(playerToken).players.length,3);
  assert.equal(game.view(playerToken).completedHand.players.length,2);
  assert.deepEqual(game.view(playerToken).completedHand,saved);
  game.start(playerToken);assert.equal(game.view(playerToken).completedHand,null);
});

test('net win/loss stats count dealt hands once, exclude busted seats and persist between hands',()=>{
  const game=headsUp();game.add('busted','Busted');game.players[2].chips=0;
  game.start(playerToken);game.act(playerToken,'fold');
  assert.deepEqual(game.players[0].stats,{handsPlayed:1,wins:0,losses:1,breakeven:0,netChips:-10,wonChips:0,lostChips:10});
  assert.equal(game.players[1].stats.wins,1);
  assert.deepEqual(game.players[2].stats,{handsPlayed:0,wins:0,losses:0,breakeven:0,netChips:0,wonChips:0,lostChips:0});
  const saved=copy(game.players.map(p=>p.stats));game.finish('duplicate finish');
  assert.deepEqual(game.players.map(p=>p.stats),saved);
  game.start(playerToken);assert.deepEqual(game.players.map(p=>p.stats),saved);
  game.act(otherToken,'fold');
  assert.deepEqual(game.players[0].stats,{handsPlayed:2,wins:1,losses:1,breakeven:0,netChips:0,wonChips:10,lostChips:10});
  assert.deepEqual(game.players[1].stats,{handsPlayed:2,wins:1,losses:1,breakeven:0,netChips:0,wonChips:10,lostChips:10});
  assert.deepEqual(game.view(playerToken).players.map(p=>p.seat),[0,1,2]);
});

test('side pots, all-ins and uncalled returns record actual net results instead of gross payouts',()=>{
  const game=new Game();[50,100,200].forEach((chips,i)=>{game.add(`p${i}`,`P${i}`);game.players[i].chips=chips;});
  game.start('p0');game.players.forEach((p,i)=>p.cards=[{v:14-i,s:1},{v:14-i,s:2}]);game.deck=copy(runout);
  game.act('p0','allin');game.act('p1','allin');game.act('p2','allin');
  const record=game.view('p0').completedHand;
  assert.deepEqual(record.players.map(p=>p.startingChips),[50,100,200]);
  assert.deepEqual(record.players.map(p=>p.endingChips),[150,100,100]);
  assert.deepEqual(record.players.map(p=>p.netChips),[100,0,-100]);
  assert.deepEqual(record.result.refunds,[{seat:2,name:'P2',amount:100}]);
  assert.ok(record.actions.every(a=>a.allIn));
  assert.deepEqual(game.players.map(p=>[p.stats.wins,p.stats.losses,p.stats.breakeven]),[[1,0,0],[0,0,1],[0,1,0]]);
  assert.equal(game.players.reduce((sum,p)=>sum+p.stats.netChips,0),0);
  assert.equal(game.players.reduce((sum,p)=>sum+p.stats.wonChips,0),100);
  assert.equal(game.players.reduce((sum,p)=>sum+p.stats.lostChips,0),100);
});

test('a shared board win with no net movement is a breakeven hand, not a profit',()=>{
  const game=headsUp();game.start(playerToken);
  game.deck=[{v:14,s:0},{v:6,s:2},{v:13,s:0},{v:5,s:2},{v:12,s:0},{v:11,s:0},{v:10,s:0},{v:4,s:2}];
  // Keep all dealt cards distinct from the forced royal-flush board.
  game.players[0].cards=[{v:2,s:1},{v:3,s:1}];game.players[1].cards=[{v:4,s:1},{v:5,s:1}];
  callToEnd(game);
  assert.ok(game.players.every(p=>p.stats.handsPlayed===1&&p.stats.breakeven===1&&p.stats.wins===0&&p.stats.losses===0));
  assert.deepEqual(game.view(playerToken).completedHand.players.map(p=>p.netChips),[0,0]);
});

test('match identity persists during a match and changes on a clean solo restart with stats reset',()=>{
  const game=new Game();game.add(playerToken,'Alice');addBot(game,'bot');
  assert.equal(game.matchStartedAt,null);
  const matchId=game.matchId;game.start(playerToken);const began=game.matchStartedAt;
  game.players[0].cards=[{v:6,s:1},{v:6,s:2}];game.players[1].cards=[{v:14,s:1},{v:14,s:2}];game.deck=copy(runout);
  game.act(playerToken,'allin');game.act('bot','call');
  assert.equal(game.players[0].chips,0);assert.equal(game.players[0].stats.losses,1);
  assert.equal(game.view(playerToken).completedHand.players[1].isBot,true);
  const fresh=restartSoloGame(game,playerToken);
  assert.notEqual(fresh.matchId,matchId);assert.equal(game.matchId,matchId);assert.equal(game.matchStartedAt,began);
  assert.equal(fresh.handId,game.handId+1);assert.ok(fresh.players.every(p=>p.stats.handsPlayed===0&&p.stats.netChips===0));
  assert.equal(fresh.view(playerToken).completedHand,null);
});
