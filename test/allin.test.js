import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
import {decide,personalities} from '../bots.js';

function start(stacks) {
  const g=new Game();
  stacks.forEach((chips,i)=>{g.add(`p${i}`,`Player ${i}`);g.players[i].chips=chips;});
  g.start('p0');return g;
}
function playCalls(g) {
  let moves=0;
  while(g.phase!=='finished'){
    assert.ok(++moves<100);
    g.act(g.players[g.turn].id,'call');
  }
}

test('full all-in raise commits the entire stack and establishes a new minimum raise',()=>{
  const g=start([100,1000,1000]);g.act('p0','allin');
  assert.equal(g.players[0].chips,0);assert.equal(g.players[0].bet,100);
  assert.equal(g.current,100);assert.equal(g.minRaise,80);assert.equal(g.turn,1);
  assert.deepEqual(g.lastAction,{sequence:1,seat:0,type:'allin',amount:100,target:100,allIn:true});
  assert.equal(g.view('p1').players[1].canRaise,true);
  assert.throws(()=>g.act('p1','raise',179));
  g.act('p1','raise',180);assert.equal(g.current,180);
  playCalls(g);assert.equal(g.players.reduce((sum,p)=>sum+p.chips,0),2100);
});

test('short all-in is legal but does not reopen an already-acted player',()=>{
  const g=start([1000,30,1000]);g.act('p0','call');g.act('p1','allin');
  assert.equal(g.current,30);assert.equal(g.minRaise,20);
  assert.equal(g.view('p2').players[2].canRaise,true); // BB still has its first option
  g.act('p2','call');assert.equal(g.turn,0);
  assert.equal(g.view('p0').players[0].canRaise,false);
  assert.throws(()=>g.act('p0','raise',50),/All-in/);
  assert.throws(()=>g.act('p0','allin'),/All-in/);
  assert.equal(g.players[0].chips,980); // rejected attempts must not change chips
  g.act('p0','call');assert.equal(g.phase,'flop');
  assert.equal(g.view('p0').players[0].canRaise,true); // new street restores rights
});

test('a full all-in raise reopens prior callers and raisers',()=>{
  const g=start([1000,1000,180]);g.act('p0','raise',100);g.act('p1','call');g.act('p2','allin');
  assert.equal(g.current,180);assert.equal(g.minRaise,80);assert.equal(g.turn,0);
  assert.equal(g.canRaise(g.players[0]),true);assert.equal(g.canRaise(g.players[1]),true);
  g.act('p0','raise',260);assert.equal(g.current,260);
});

test('cumulative short all-ins reopen action once they total one full raise',()=>{
  const g=start([30,40,1000,1000]);assert.equal(g.turn,3);
  g.act('p3','call');g.act('p0','allin');
  assert.equal(g.current,30);assert.equal(g.canRaise(g.players[3]),false);
  g.act('p1','allin');assert.equal(g.current,40);assert.equal(g.minRaise,20);
  assert.equal(g.canRaise(g.players[3]),true);
  g.act('p2','call');assert.equal(g.turn,3);
  g.act('p3','raise',60);assert.equal(g.current,60);assert.equal(g.minRaise,20);
});

test('all-in call below the current bet does not change the wager or minimum raise',()=>{
  const g=start([1000,50,1000]);g.act('p0','raise',100);
  g.act('p1','allin');assert.equal(g.players[1].chips,0);assert.equal(g.players[1].bet,50);
  assert.equal(g.current,100);assert.equal(g.minRaise,80);
  assert.equal(g.lastAction.type,'allin');assert.equal(g.lastAction.allIn,true);
  assert.equal(g.lastAction.amount,40);assert.equal(g.lastAction.target,50);
  g.act('p2','call');assert.equal(g.phase,'flop');
  playCalls(g);assert.equal(g.players.reduce((sum,p)=>sum+p.chips,0),2050);
});

test('ordinary calls and raises that empty a stack also report all-in',()=>{
  const caller=start([1000,50,1000]);caller.act('p0','raise',100);caller.act('p1','call');
  assert.equal(caller.lastAction.type,'call');assert.equal(caller.lastAction.allIn,true);
  const raiser=start([100,1000,1000]);raiser.act('p0','raise',100);
  assert.equal(raiser.lastAction.type,'raise');assert.equal(raiser.lastAction.allIn,true);
});

test('all-in call remains legal even when prior short raise did not reopen raising',()=>{
  const g=start([30,30,1000]);g.act('p0','call');g.act('p1','allin');g.act('p2','call');
  assert.equal(g.turn,0);assert.equal(g.view('p0').players[0].canRaise,false);
  g.act('p0','allin',undefined,{deferProgress:true});assert.equal(g.players[0].chips,0);assert.equal(g.lastAction.allIn,true);
  g.advance();assert.equal(g.phase,'finished');assert.equal(g.board.length,5);
  assert.equal(g.players.reduce((sum,p)=>sum+p.chips,0),1060);
});

test('deferred all-in keeps the old street visible and forbids duplicate actions',()=>{
  const g=start([100,1000]);g.act('p0','allin',undefined,{deferProgress:true});
  assert.equal(g.phase,'preflop');assert.equal(g.board.length,0);assert.equal(g.turn,-1);
  assert.equal(g.view('p0').actionPending,true);assert.equal(g.lastAction.allIn,true);
  assert.equal(g.view('p1').players[1].canRaise,false);
  assert.throws(()=>g.act('p0','allin'));assert.throws(()=>g.act('p1','call'));
  g.advance();assert.equal(g.turn,1);
  g.act('p1','call',undefined,{deferProgress:true});assert.equal(g.board.length,0);
  g.advance();assert.equal(g.phase,'finished');assert.equal(g.board.length,5);
  assert.equal(g.players.reduce((sum,p)=>sum+p.chips,0),1100);
});

test('multiway all-ins resolve separate side pots and unmatched chips correctly',()=>{
  const g=start([50,100,200]);
  g.players[0].cards=[{v:14,s:1},{v:14,s:2}];
  g.players[1].cards=[{v:13,s:1},{v:13,s:2}];
  g.players[2].cards=[{v:12,s:1},{v:12,s:2}];
  // Burn then deal each known street from the end of the deck.
  g.deck=[{v:11,s:0},{v:5,s:0},{v:9,s:3},{v:6,s:0},{v:7,s:2},{v:3,s:1},{v:2,s:0},{v:4,s:0}];
  g.act('p0','allin');g.act('p1','allin');g.act('p2','allin');
  assert.equal(g.phase,'finished');assert.equal(g.board.length,5);
  assert.deepEqual(g.players.map(p=>p.chips),[150,100,100]);
  assert.deepEqual(g.result.winners.map(p=>[p.seat,p.amount]),[[0,150],[1,100]]);
  assert.deepEqual(g.result.refunds,[{seat:2,name:'Player 2',amount:100}]);
  assert.equal(g.result.pot,250);assert.equal(g.players.reduce((sum,p)=>sum+p.chips,0),350);
});


test('bot facing a short all-in chooses a legal response when raising is closed',()=>{
  const g=start([1000,30,1000]);
  Object.assign(g.players[0],{bot:{...personalities[1]},mood:0,cards:[{v:14,s:0},{v:14,s:1}]});
  g.act('p0','call');g.act('p1','allin');g.act('p2','call');
  assert.equal(g.turn,0);assert.equal(g.canRaise(g.players[0]),false);
  const action=decide(g,0,()=>.05);assert.equal(action.type,'call');
  assert.doesNotThrow(()=>g.act('p0',action.type,action.amount));
});
