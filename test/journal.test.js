import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JournalStore,normalizeHand,summarize,STORAGE_KEY} from '../public/journal.js';

function memory(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
function hand(id=1,actions=[]){return {matchId:'match-a',handId:id,startedAt:1000*id,endedAt:1000*id+500,viewerSeat:0,
 dealer:0,smallBlind:0,bigBlind:1,blinds:{small:10,big:20},
 players:[{seat:0,name:'Alice',startingChips:1000,endingChips:1010,netChips:10,holeCards:[{v:14,s:0},{v:14,s:1}],folded:false},
 {seat:1,name:'Bob',startingChips:1000,endingChips:990,netChips:-10,holeCards:[null,null],folded:true}],
 blindPosts:[{seat:0,type:'smallBlind',amount:10,street:'preflop'},{seat:1,type:'bigBlind',amount:20,street:'preflop'}],
 board:[],actions,result:{reason:'fold',pot:20,winners:[{seat:0,name:'Alice',amount:20,handName:null}],refunds:[]}};}

test('completed hand storage deduplicates SSE and reload without retaining secrets',()=>{
 const storage=memory(),store=new JournalStore({storage}),input=hand();
 input.token='do-not-store';input.deck=[{v:2,s:0}];input.players[0].id='secret-id';input.actions=[{seat:0,type:'call',amount:10,street:'preflop',headers:{authorization:'secret'}}];
 assert.equal(store.add(input,0),true);assert.equal(store.add(input,0),false);assert.equal(store.hands.length,1);
 const saved=storage.getItem(STORAGE_KEY);assert.ok(!saved.includes('do-not-store'));assert.ok(!saved.includes('secret'));assert.ok(!saved.includes('deck'));
 const restored=new JournalStore({storage});assert.equal(restored.hands.length,1);assert.equal(restored.add(input,0),false);
 assert.deepEqual(restored.hands[0].players[0].holeCards,input.players[0].holeCards);
});

test('recorded opponent cards are restricted to revealed showdowns',()=>{
 const input=hand();input.players[1].holeCards=[{v:13,s:2},{v:13,s:3}];
 assert.deepEqual(normalizeHand(input,0).players[1].holeCards,[null,null]);
 input.result.reason='showdown';assert.deepEqual(normalizeHand(input,0).players[1].holeCards,[null,null]);
 input.players[1].folded=false;
 assert.deepEqual(normalizeHand(input,0).players[1].holeCards,input.players[1].holeCards);
 input.players[0].folded=true;assert.deepEqual(normalizeHand(input,0).players[0].holeCards,input.players[0].holeCards);
});

test('bounded history preserves newest records and reports pruning',()=>{
 const storage=memory(),store=new JournalStore({storage,maxHands:2});
 store.add(hand(1),0);store.add(hand(2),0);store.add(hand(3),0);
 assert.deepEqual(store.hands.map(h=>h.handId),[2,3]);assert.equal(store.prunedCount,1);
 assert.equal(store.add(hand(1),0),false);assert.equal(store.prunedCount,1);
 const restored=new JournalStore({storage,maxHands:2});assert.equal(restored.add(hand(1),0),false);assert.deepEqual(restored.hands.map(h=>h.handId),[2,3]);
});

test('paused recording persists preference, clear is explicit and resumes new history',()=>{
 const storage=memory(),store=new JournalStore({storage});store.add(hand(1),0);store.setEnabled(false);
 assert.equal(store.add(hand(2),0),false);const restored=new JournalStore({storage});assert.equal(restored.enabled,false);assert.equal(restored.hands.length,1);
 restored.clear();assert.equal(restored.hands.length,0);assert.equal(restored.enabled,false);
 restored.setEnabled(true);assert.equal(restored.add(hand(1),0),false);assert.equal(restored.add(hand(3),0),true);
});

test('corrupt or future storage stays intact while new hands survive in memory',()=>{
 for(const raw of ['broken JSON',JSON.stringify({version:99,hands:[]})]){
 const storage=memory();storage.setItem(STORAGE_KEY,raw);const store=new JournalStore({storage});
 assert.equal(store.readOnly,true);assert.equal(store.add(hand(),0),true);assert.equal(store.hands.length,1);assert.equal(store.persistent,false);assert.equal(storage.getItem(STORAGE_KEY),raw);
 store.clear();assert.equal(store.readOnly,false);assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).version,1);
 }
 assert.equal(normalizeHand({...hand(),players:[null]}),null);
 assert.equal(normalizeHand({...hand(),board:[{v:99,s:0}]}),null);
});

test('quota and unavailable storage do not lose the current in-memory record',()=>{
 const store=new JournalStore({storage:{getItem:()=>null,setItem:()=>{throw Error('QuotaExceededError');}}});
 assert.equal(store.add(hand(),0),true);assert.equal(store.hands.length,1);assert.equal(store.persistent,false);assert.match(store.status,/Exportiere/);
 const unavailable=new JournalStore();assert.equal(unavailable.add(hand(),0),true);assert.equal(unavailable.persistent,false);
 const blocked=new JournalStore({storage:{getItem:()=>{throw Error('SecurityError');},setItem:()=>{throw Error();}}});
 assert.equal(blocked.add(hand(),0),true);assert.equal(blocked.hands.length,1);
});

test('VPIP/PFR exclude blinds and checks, count voluntary participation once per hand',()=>{
 const a=normalizeHand(hand(1,[{seat:0,type:'check',street:'preflop',amount:0}]),0);
 const b=normalizeHand(hand(2,[{seat:0,type:'call',street:'preflop',amount:20},{seat:0,type:'raise',street:'preflop',amount:40,target:60,currentBetBefore:20}]),0);
 const c=normalizeHand(hand(3,[{seat:0,type:'allin',street:'preflop',amount:10,target:30,currentBetBefore:100,allIn:true}]),0);
 const stats=summarize([a,b,c]);assert.equal(stats.handsPlayed,3);assert.equal(stats.vpipHands,2);assert.equal(stats.pfrHands,1);assert.equal(stats.allInHands,1);
 assert.equal(stats.vpip,2/3);assert.equal(stats.pfr,1/3);assert.equal(stats.wins,3);assert.equal(stats.netChips,30);
});

test('postflop aggression treats short all-in raises as aggression and all-in calls as calls',()=>{
 const h=normalizeHand(hand(1,[{seat:0,type:'raise',street:'flop',amount:50,target:50,currentBetBefore:0},
 {seat:0,type:'check',street:'turn',amount:0},{seat:0,type:'allin',street:'turn',amount:10,target:60,currentBetBefore:50,allIn:true},
 {seat:0,type:'allin',street:'river',amount:10,target:70,currentBetBefore:100,allIn:true}]),0);
 const stats=summarize([h]);assert.equal(stats.postflopRaises,2);assert.equal(stats.postflopCalls,1);assert.equal(stats.aggressionFactor,2);
});

test('player-specific stats deduplicate different viewers of the same hand and use net outcomes',()=>{
 const first=normalizeHand(hand(),0),second=normalizeHand(hand(),1),next=normalizeHand(hand(2),0);
 const stats=summarize([first,second,next],{matchId:'match-a',seat:1});
 assert.equal(stats.handsPlayed,2);assert.equal(stats.losses,2);assert.equal(stats.netChips,-20);assert.equal(stats.winRate,0);assert.equal(stats.lostChips,20);
 const other=normalizeHand({...hand(3),matchId:'match-b'},0);
 assert.equal(summarize([first,other],{matchId:'match-a',seat:0}).handsPlayed,1);
});

test('descriptive styles disclose sample size and do not infer strategy from tiny histories',()=>{
 const stats=summarize([normalizeHand(hand(),0)]);assert.equal(stats.style,'Noch zu wenig Hände');assert.match(stats.observations[0],/Kleine Stichprobe/);
 const hands=Array.from({length:30},(_,i)=>normalizeHand(hand(i+1,[{seat:0,type:'call',street:'preflop',amount:20}]),0));
 const sample=summarize(hands);assert.match(sample.style,/loose/);assert.match(sample.style,/passiv/);assert.ok(sample.observations.some(note=>note.includes('Calls')||note.includes('Call')));
});


test('stale tabs merge independent completed hands and settings never erase another tab',()=>{
 const storage=memory(),a=new JournalStore({storage}),b=new JournalStore({storage});
 assert.equal(a.add(hand(1),0),true);assert.equal(b.add(hand(2),0),true);
 assert.deepEqual(new JournalStore({storage}).hands.map(h=>h.handId),[1,2]);
 a.setEnabled(false);
 const saved=new JournalStore({storage});assert.deepEqual(saved.hands.map(h=>h.handId),[1,2]);assert.equal(saved.enabled,false);
 assert.equal(b.add(hand(3),0),false); // refresh respects the other tab's opt-out
 b.setEnabled(true);assert.equal(b.add(hand(3),0),true);
 a.refresh();assert.deepEqual(a.hands.map(h=>h.handId),[1,2,3]);assert.equal(a.enabled,true);
});

test('explicit clear generation prevents stale tabs from restoring old records',()=>{
 const storage=memory(),a=new JournalStore({storage});a.add(hand(1),0);
 const b=new JournalStore({storage});b.add(hand(2),0);a.clear();
 assert.equal(new JournalStore({storage}).hands.length,0);
 assert.equal(b.add(hand(2),0),false); // a repeated old completed-hand SSE stays deleted
 assert.equal(b.add(hand(3),0),true);
 assert.deepEqual(new JournalStore({storage}).hands.map(h=>h.handId),[3]);
 a.setEnabled(false);assert.deepEqual(new JournalStore({storage}).hands.map(h=>h.handId),[3]);
});

test('refresh merges persisted records without dropping unsaved quota entries',()=>{
 const storage=memory(),write=storage.setItem;let blocked=true;
 const guarded={getItem:storage.getItem,setItem:(key,value)=>{if(blocked)throw Error('Quota');write(key,value);}};
 const a=new JournalStore({storage:guarded});a.add(hand(1),0);assert.equal(a.persistent,false);
 const b=new JournalStore({storage});b.add(hand(2),0);
 a.refresh();assert.deepEqual(a.hands.map(h=>h.handId),[1,2]);
 blocked=false;a.add(hand(3),0);
 assert.deepEqual(new JournalStore({storage}).hands.map(h=>h.handId),[1,2,3]);
});

test('a stale tab cannot overwrite a newly corrupted or future storage envelope',()=>{
 const storage=memory(),a=new JournalStore({storage});a.add(hand(1),0);
 const future=JSON.stringify({version:55,hands:[]});storage.setItem(STORAGE_KEY,future);
 a.add(hand(2),0);a.setEnabled(false);assert.equal(storage.getItem(STORAGE_KEY),future);
 assert.deepEqual(a.hands.map(h=>h.handId),[1,2]);assert.equal(a.readOnly,true);
});
