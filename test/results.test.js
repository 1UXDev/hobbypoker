import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
import {handName, rank} from '../poker.js';

const board = [{v:2,s:0},{v:3,s:1},{v:7,s:2},{v:9,s:3},{v:11,s:0}];
function showdown(totals, folded=[]) {
  const game = new Game();
  totals.forEach((total,i) => {
    game.add(`token-${i}`, `Player ${i}`);
    Object.assign(game.players[i], {
      chips:1000-total, total, handStart:1000,
      cards:[{v:14-i,s:1},{v:14-i,s:2}], folded:folded.includes(i),
    });
  });
  game.board=board;game.dealer=0;game.handId=4;
  return game;
}

test('standard hand names include wheel straight flush and royal flush', () => {
  assert.equal(handName(rank([14,2,3,4,5].map(v=>({v,s:1})))), 'Straight Flush');
  assert.equal(handName(rank([10,11,12,13,14].map(v=>({v,s:2})))), 'Royal Flush');
  assert.deepEqual(Array.from({length:8},(_,i)=>handName([i,9])), [
    'High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind',
  ]);
});

test('fold win separates returned unmatched chips and records net win/loss', () => {
  const game=new Game();game.add('a','Alice');game.add('b','Bob');game.start('a');
  game.act('a','fold');
  assert.deepEqual(game.result, {
    handId:1,reason:'fold',pot:20,
    winners:[{seat:1,name:'Bob',amount:20,handName:null}],
    refunds:[{seat:1,name:'Bob',amount:10}],
  });
  assert.deepEqual(game.players.map(p=>p.lastHandDelta),[-10,10]);
  assert.deepEqual(game.view('a').players[1].cards,[null,null]);
  assert.equal(game.view('a').players[1].handName,null);
});

test('next hand resets results and retains the previous hand delta', () => {
  const game=new Game();game.add('a','Alice');game.add('b','Bob');game.start('a');game.act('a','fold');
  game.start('a');
  assert.equal(game.handId,2);assert.equal(game.result,null);
  assert.deepEqual(game.players.map(p=>p.lastHandDelta),[-10,10]);
  assert.ok(game.view('a').players.every(p=>!p.winner));
  assert.throws(()=>game.start('a'));
  assert.equal(game.handId,2);
});

test('river fold never reveals the surviving opponent cards or hand name', () => {
  const game=new Game();game.add('a','Alice');game.add('b','Bob');game.start('a');
  while(game.phase!=='river')game.act(game.players[game.turn].id,'call');
  const folder=game.players[game.turn].id;
  game.act(folder,'fold');
  const other=game.view(folder).players.find(p=>!p.me);
  assert.equal(game.board.length,5);assert.equal(game.result.reason,'fold');
  assert.deepEqual(other.cards,[null,null]);assert.equal(other.handName,null);
});

test('different side pot winners are named and unmatched return is not a win', () => {
  const game=showdown([50,100,200]);game.showdown();
  assert.equal(game.result.pot,250);
  assert.deepEqual(game.result.winners,[
    {seat:0,name:'Player 0',amount:150,handName:'One Pair'},
    {seat:1,name:'Player 1',amount:100,handName:'One Pair'},
  ]);
  assert.deepEqual(game.result.refunds,[{seat:2,name:'Player 2',amount:100}]);
  assert.deepEqual(game.players.map(p=>p.lastHandDelta),[100,0,-100]);
  assert.deepEqual(game.view('token-0').players.map(p=>p.winner),[true,true,false]);
  assert.equal(game.players.reduce((sum,p)=>sum+p.chips,0),3000);
  assert.ok(game.view('token-0').players.every(p=>p.cards.every(Boolean)));
});

test('split pots award odd chips left of the dealer and identify ties', () => {
  const game=showdown([5,5,1],[2]);
  game.board=[10,11,12,13,14].map(v=>({v,s:0}));game.showdown();
  assert.deepEqual(game.result.winners,[
    {seat:1,name:'Player 1',amount:6,handName:'Royal Flush'},
    {seat:0,name:'Player 0',amount:5,handName:'Royal Flush'},
  ]);
  assert.deepEqual(game.players.map(p=>p.lastHandDelta),[0,1,-1]);
  assert.equal(game.result.pot,11);
  assert.deepEqual(game.view('token-0').players[2].cards,[null,null]);
  assert.equal(game.view('token-0').players[2].handName,null);
});

test('public views exclude bot personality, mood and session identifiers', () => {
  const game=new Game();game.add('secret-a','Alice');game.add('secret-b','Bot');
  Object.assign(game.players[1],{bot:{style:'Maniac',bluff:.8},mood:2});game.start('secret-a');
  const view=game.view('secret-a'), json=JSON.stringify(view);
  assert.equal(view.players[1].isBot,true);
  assert.equal('bot' in view.players[1],false);assert.equal('mood' in view.players[1],false);
  assert.equal('id' in view.players[1],false);
  assert.ok(!json.includes('secret-'));assert.ok(!json.includes('Maniac'));
});
