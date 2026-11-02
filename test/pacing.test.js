import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
import {addBot} from '../bots.js';
import {createPacer, BOT_THINK_MS, ACTION_HOLD_MS} from '../server.js';

function game() {
  const g=new Game();g.add('a','Alice');g.add('b','Bob');g.start('a');return g;
}
function fakeClock() {
  let time=0,id=0;
  const jobs=new Map();
  return {
    setTimer(fn,delay){jobs.set(++id,{fn,at:time+delay});return id;},
    clearTimer(id){jobs.delete(id);},
    tick(ms){
      const end=time+ms;
      for(let count=0;count<100;count++){
        const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next||next[1].at>end){time=end;return;}
        time=next[1].at;jobs.delete(next[0]);next[1].fn();
      }
      throw Error('Unbounded timer loop');
    },
    get size(){return jobs.size;},
  };
}

test('deferred action publishes chips and pauses all actors until advance',()=>{
  const g=game();g.act('a','call',undefined,{deferProgress:true});
  const view=g.view('a');
  assert.equal(view.turn,-1);assert.equal(view.actionPending,true);assert.equal(view.actingSeat,0);
  assert.deepEqual(view.lastAction,{sequence:1,seat:0,type:'call',amount:10,target:20});
  assert.equal(view.pot,40);assert.equal(g.players[0].chips,980);
  assert.deepEqual(g.board,[]);
  assert.throws(()=>g.act('a','call'));assert.throws(()=>g.act('b','call'));
  assert.throws(()=>g.start('a'));
  assert.equal(g.advance(),true);assert.equal(g.turn,1);assert.equal(g.view('a').actionPending,false);
  assert.equal(g.advance(),false);
});

test('last check stays on its street throughout hold, then advances board',()=>{
  const g=game();g.act('a','call');
  g.act('b','call',undefined,{deferProgress:true});
  assert.equal(g.phase,'preflop');assert.equal(g.board.length,0);
  assert.equal(g.lastAction.type,'check');assert.equal(g.lastAction.amount,0);
  assert.equal(g.players[1].bet,20);assert.equal(g.turn,-1);
  g.advance();assert.equal(g.phase,'flop');assert.equal(g.board.length,3);
});

test('fold result and payouts wait for the display hold before settling',()=>{
  const g=game();g.act('a','fold',undefined,{deferProgress:true});
  assert.equal(g.phase,'preflop');assert.equal(g.result,null);
  assert.deepEqual(g.players.map(p=>p.chips),[990,980]);
  g.advance();assert.equal(g.phase,'finished');
  assert.deepEqual(g.players.map(p=>p.lastHandDelta),[-10,10]);
  g.start('a');assert.equal(g.lastAction,null);assert.equal(g.pendingAdvance,null);
});

test('bot thinks for 2s, holds its action for 1s, then opens the next turn',()=>{
  assert.equal(BOT_THINK_MS,2000);assert.equal(ACTION_HOLD_MS,1000);
  const g=new Game();g.add('a','Alice');addBot(g,'bot');g.start('a');
  const clock=fakeClock(),states=[];
  const room={game:g,scored:false};
  const pace=createPacer(room,{setTimer:clock.setTimer,clearTimer:clock.clearTimer,
    publish:()=>states.push(structuredClone(g.view('a'))),chooseAction:()=>({type:'call'})});
  g.act('a','call',undefined,{deferProgress:true});pace.schedule();pace.schedule();
  assert.equal(clock.size,1);
  clock.tick(999);assert.equal(g.turn,-1);assert.equal(states.length,0);
  clock.tick(1);assert.equal(g.turn,1);assert.equal(states.length,1);
  clock.tick(1999);assert.equal(g.turn,1);assert.equal(g.actionSequence,1);
  clock.tick(1);assert.equal(g.turn,-1);assert.equal(g.actionSequence,2);
  assert.equal(g.phase,'preflop');assert.equal(g.board.length,0);
  assert.equal(states.at(-1).lastAction.type,'check');assert.equal(states.at(-1).actionPending,true);
  clock.tick(999);assert.equal(g.board.length,0);
  clock.tick(1);assert.equal(g.phase,'flop');assert.equal(g.turn,1);
  assert.equal(clock.size,1); // next bot now starts its own 2s think time
  pace.stop();assert.equal(clock.size,0);
});

test('paced completion scores bot mood exactly once',()=>{
  const g=new Game();g.add('a','Alice');addBot(g,'bot');g.start('a');
  const clock=fakeClock(),room={game:g,scored:false};
  const pace=createPacer(room,{setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  g.act('a','fold',undefined,{deferProgress:true});pace.schedule();
  assert.equal(g.players[1].mood,0);clock.tick(1000);
  assert.equal(g.phase,'finished');assert.equal(g.players[1].mood,1);
  pace.schedule();pace.schedule();assert.equal(g.players[1].mood,1);assert.equal(clock.size,0);
});

test('timer decision errors are caught without crashing or rescheduling forever',()=>{
  const g=new Game();g.add('a','Alice');addBot(g,'bot');g.start('a');g.act('a','call');
  const clock=fakeClock(),errors=[];
  const pace=createPacer({game:g},{setTimer:clock.setTimer,clearTimer:clock.clearTimer,
    chooseAction:()=>{throw Error('Broken policy');},onError:e=>errors.push(e.message)});
  pace.schedule();clock.tick(2000);
  assert.deepEqual(errors,['Broken policy']);assert.equal(clock.size,0);
  assert.equal(g.turn,1);pace.stop();
});
