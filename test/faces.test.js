import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appearanceFor, emotionFor} from '../public/faces.js';

function game() {
  return {
    handId: 1, phase: 'flop', turn: 0, pot: 100, actionPending: false,
    players: [{name:'Mara',chips:800,isBot:true}, {name:'Ben',chips:700,isBot:true}],
  };
}

test('pixel appearances are deterministic and vary across named seats', () => {
  assert.deepEqual(appearanceFor('Mara', 1), appearanceFor('Mara', 1));
  const faces = new Set(['Mara','Ada','Finn','Nora','Leo','Ben'].map((name,i)=>JSON.stringify(appearanceFor(name,i))));
  assert.ok(faces.size >= 5);
});

test('active bot thinks and observes a large bet without seeing private cards', () => {
  const g = game();
  assert.equal(emotionFor(g,0), 'thinking');
  assert.equal(emotionFor(g,1), 'neutral');
  Object.assign(g,{turn:-1,actionPending:true,lastAction:{sequence:1,seat:0,type:'raise',amount:80}});
  assert.equal(emotionFor(g,0), 'focused');
  assert.equal(emotionFor(g,1), 'worried');
  g.players[1].folded = true;
  assert.equal(emotionFor(g,1), 'neutral');
});

test('an all-in surprises observers while winning and losing produce distinct faces', () => {
  const g = game();
  Object.assign(g,{turn:-1,actionPending:true,lastAction:{sequence:1,seat:0,type:'allin',amount:800,allIn:true}});
  assert.equal(emotionFor(g,0), 'focused');
  assert.equal(emotionFor(g,1), 'surprised');
  g.phase = 'finished';g.players[0].lastHandDelta = -800;g.players[1].lastHandDelta = 800;
  assert.equal(emotionFor(g,0), 'sad');
  assert.equal(emotionFor(g,1), 'happy');
});

test('hidden hands, mood and private profile values cannot influence facial reactions', () => {
  const a = game(), b = game();
  a.players[0].cards = [{v:14,s:0},{v:14,s:1}];
  b.players[0].cards = [{v:2,s:0},{v:7,s:1}];
  a.players[0].mood = -2;b.players[0].mood = 2;
  a.players[0].bot = {aversion:1};b.players[0].bot = {aversion:0};
  assert.equal(emotionFor(a,0), emotionFor(b,0));
  assert.equal(emotionFor(a,1), emotionFor(b,1));
});
