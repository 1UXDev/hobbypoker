import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
import {addBot} from '../bots.js';
import {server,soloBusted,restartSoloGame,createPacer,NEXT_HAND_MS} from '../server.js';

function bustedGame() {
  const game=new Game();
  game.add('human','Alice');addBot(game,'bot-a');addBot(game,'bot-b');
  game.start('human');
  game.phase='finished';game.turn=-1;game.pendingAdvance=null;
  game.players.forEach((player,index)=>Object.assign(player,{chips:index?1500:0,lastHandDelta:index?500:-1000}));
  game.players[1].mood=2;game.players[2].mood=-1;
  game.result={handId:game.handId,reason:'showdown',pot:3000,winners:[],refunds:[]};
  return game;
}

test('solo bust prevents bot-only automatic deals and manual starts',()=>{
  const game=bustedGame(),timers=[];
  const pace=createPacer({game,scored:true},{setTimer:(fn,delay)=>{timers.push({fn,delay});return timers.length;}});
  assert.equal(soloBusted(game),true);
  pace.schedule();pace.schedule();
  assert.equal(timers.length,0);assert.equal(game.nextHandAt,null);
  assert.throws(()=>pace.start('human'),/ausgeschieden/);
  assert.equal(game.handId,1);assert.equal(game.phase,'finished');
  pace.stop();
});

test('restart preserves seats, sessions and personalities while resetting the match',()=>{
  const game=bustedGame();game.handId=12;game.nextHandAt=9999;
  const snapshot=structuredClone(game);
  const fresh=restartSoloGame(game,'human');
  assert.notEqual(fresh,game);
  assert.equal(fresh.handId,13);assert.equal(fresh.phase,'preflop');
  assert.equal(fresh.result,null);assert.equal(fresh.nextHandAt,null);
  assert.equal(fresh.pendingAdvance,null);assert.equal(soloBusted(fresh),false);
  assert.deepEqual(fresh.players.map(p=>[p.id,p.name]),game.players.map(p=>[p.id,p.name]));
  assert.equal(fresh.players.reduce((total,p)=>total+p.chips+p.total,0),3000);
  assert.ok(fresh.players.every(p=>p.handStart===1000&&p.lastHandDelta===null&&p.cards.length===2));
  for(let i=1;i<fresh.players.length;i++){
    assert.deepEqual(fresh.players[i].bot,game.players[i].bot);
    assert.notEqual(fresh.players[i].bot,game.players[i].bot);
    assert.equal(fresh.players[i].mood,0);
  }
  assert.deepEqual(structuredClone(game),snapshot);
  assert.throws(()=>restartSoloGame(fresh,'human'));
});

test('restart rejection never changes a running or ineligible game',()=>{
  const cases=[
    [g=>{g.phase='preflop';},'human'],
    [g=>{g.players[0].chips=1;},'human'],
    [g=>g.add('other-human','Bob'),'human'],
    [g=>{for(const p of g.players)delete p.bot;},'human'],
    [()=>{},'missing-token'],
    [()=>{},'bot-a'],
  ];
  for(const [adjust,id] of cases){
    const game=bustedGame();adjust(game);
    const snapshot=structuredClone(game);
    assert.throws(()=>restartSoloGame(game,id));
    assert.deepEqual(structuredClone(game),snapshot);
  }
});

test('non-busted solo games and multiplayer continue to schedule hands normally',()=>{
  const game=bustedGame();game.players[0].chips=10;
  const jobs=[];
  const pace=createPacer({game,scored:true},{setTimer:(fn,delay)=>{jobs.push({fn,delay});return jobs.length;},clearTimer:()=>{},now:()=>100});
  pace.schedule();assert.equal(jobs.length,1);assert.equal(jobs[0].delay,NEXT_HAND_MS);
  assert.equal(game.nextHandAt,100+NEXT_HAND_MS);pace.stop();
  const multi=bustedGame();multi.add('other-human','Bob');
  assert.equal(soloBusted(multi),false);
  const multiplayerJobs=[];
  const multiplayerPace=createPacer({game:multi,scored:true},{setTimer:(fn,delay)=>{multiplayerJobs.push(delay);return 1;},clearTimer:()=>{}});
  multiplayerPace.schedule();assert.deepEqual(multiplayerJobs,[NEXT_HAND_MS]);multiplayerPace.stop();
});

test('stale deal callbacks cannot advance a busted or restarted game',()=>{
  const game=bustedGame();game.players[0].chips=10;
  const callbacks=[];
  const room={game,scored:true};
  const pace=createPacer(room,{setTimer:fn=>{callbacks.push(fn);return callbacks.length;},clearTimer:()=>{}});
  pace.schedule();assert.equal(callbacks.length,1);
  game.players[0].chips=0;
  callbacks[0]();
  assert.equal(game.phase,'finished');assert.equal(game.handId,1);
  assert.equal(game.nextHandAt,null);assert.equal(callbacks.length,1);
  pace.stop();

  game.players[0].chips=10;
  const stale=[];
  const oldPace=createPacer(room,{setTimer:fn=>{stale.push(fn);return 1;},clearTimer:()=>{}});
  oldPace.schedule();game.players[0].chips=0;
  const fresh=restartSoloGame(room.game,'human');
  oldPace.stop();room.game=fresh;
  stale[0]();
  assert.equal(room.game.handId,2);assert.equal(room.game.phase,'preflop');
  assert.equal(room.game.lastAction,null);assert.equal(room.game.nextHandAt,null);
});

test('HTTP restart requires an authenticated busted solo game and leaves live state unchanged',async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,data)=>{
    const response=await fetch(base+path,{method:'POST',body:JSON.stringify(data)});
    return {status:response.status,body:await response.json()};
  };
  const view=async session=>{
    const response=await fetch(`${base}/events?room=${session.room}&token=${session.token}`);
    const reader=response.body.getReader();
    try{return JSON.parse(new TextDecoder().decode((await reader.read()).value).trim().slice(6));}
    finally{await reader.cancel();}
  };
  try{
    const session=(await post('/join',{name:'Alice'})).body;
    assert.equal((await post('/bot',session)).status,200);
    const waiting=await view(session);assert.equal(waiting.soloBusted,false);
    assert.equal((await post('/restart',session)).status,400);
    assert.equal((await post('/restart',{...session,token:'invalid'})).status,400);
    assert.equal((await view(session)).handId,0);
    assert.equal((await post('/start',session)).status,200);
    assert.equal((await post('/restart',session)).status,400);
    const running=await view(session);
    assert.equal(running.handId,1);assert.equal(running.phase,'preflop');assert.equal(running.soloBusted,false);
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
