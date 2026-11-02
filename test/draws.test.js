import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDraws} from '../draws.js';

const c = (v,s) => ({v,s});
const close = (actual,expected) => assert.ok(Math.abs(actual-expected) < 1e-12, `${actual} != ${expected}`);

test('open-ended straight draw has eight outs and exact flop/river chances', () => {
  const input = {cards:[c(8,2),c(7,1)],board:[c(2,2),c(10,3),c(9,0)]};
  const before = JSON.stringify(input);
  const {draws} = analyzeDraws(input);
  const straight = draws.find(draw => draw.category === 4);
  assert.equal(straight.handName,'Straight');
  assert.equal(straight.outs,8);
  assert.deepEqual(straight.ranks,[6,11]);
  close(straight.nextCardProbability,8/47);
  close(straight.byRiverProbability,1-(39*38)/(47*46));
  assert.equal(straight.runnerRunner,false);
  assert.equal(draws[0],straight);
  assert.equal(JSON.stringify(input),before);
});

test('turn draw has a single remaining card and excludes every known card', () => {
  const {draws} = analyzeDraws({cards:[c(8,2),c(7,1)],board:[c(2,2),c(10,3),c(9,0),c(14,2)]});
  const straight = draws.find(draw => draw.category === 4);
  assert.equal(straight.outs,8);
  close(straight.nextCardProbability,8/46);
  close(straight.byRiverProbability,8/46);
  assert.ok(draws.every(draw => !draw.runnerRunner));
});

test('flush keeps all nine suit outs including straight-flush completions', () => {
  const {draws} = analyzeDraws({cards:[c(8,0),c(7,0)],board:[c(9,0),c(10,0),c(2,1)]});
  const flush = draws.find(draw => draw.category === 5);
  const straight = draws.find(draw => draw.category === 4);
  const straightFlush = draws.find(draw => draw.category === 8);
  assert.equal(flush.outs,9);
  assert.deepEqual(flush.nextCardCards.map(card => card.s),Array(9).fill(0));
  assert.deepEqual(flush.nextCardCards.map(card => card.v),[2,3,4,5,6,11,12,13,14]);
  close(flush.nextCardProbability,9/47);
  close(flush.byRiverProbability,1-(38*37)/(47*46));
  assert.equal(straight.outs,8);
  assert.equal(straightFlush.outs,2);
  assert.deepEqual(straightFlush.ranks,[6,11]);
});

test('wheel gutshot treats ace low and identifies only rank five', () => {
  const {draws} = analyzeDraws({cards:[c(14,0),c(2,1)],board:[c(3,2),c(4,3),c(13,0)]});
  const straight = draws.find(draw => draw.category === 4);
  assert.equal(straight.outs,4);
  assert.deepEqual(straight.ranks,[5]);
  close(straight.nextCardProbability,4/47);
});

test('runner-runner flush has no immediate outs and exact two-card probability', () => {
  const {draws} = analyzeDraws({cards:[c(14,0),c(2,0)],board:[c(7,0),c(10,1),c(4,2)]});
  const flush = draws.find(draw => draw.category === 5);
  assert.equal(flush.outs,0);
  assert.deepEqual(flush.ranks,[]);
  assert.equal(flush.runnerRunner,true);
  close(flush.nextCardProbability,0);
  close(flush.byRiverProbability,(10*9)/(47*46));
});

test('already made categories do not appear as draws; preflop and river are empty', () => {
  const {draws} = analyzeDraws({cards:[c(8,2),c(7,1)],board:[c(6,2),c(10,3),c(9,0)]});
  assert.ok(draws.every(draw => draw.category > 4));
  assert.deepEqual(analyzeDraws({cards:[c(8,2),c(7,1)],board:[]}),{draws:[]});
  assert.deepEqual(analyzeDraws({cards:[c(8,2),c(7,1)],board:[c(2,2),c(10,3),c(9,0),c(14,2),c(13,0)]}),{draws:[]});
});

test('rejects hidden/malformed cards, duplicate known cards and invalid boards', () => {
  const base = {cards:[c(14,0),c(13,0)],board:[c(2,0),c(3,1),c(4,2)]};
  for (const invalid of [
    {cards:[null,c(13,0)]}, {cards:[c(1,0),c(13,0)]}, {cards:[c(14,4),c(13,0)]},
    {cards:[c(14,0),c(14,0)]}, {cards:[c(14,0)]}, {board:[c(14,0),c(2,1),c(3,1)]},
    {board:[c(2,0)]}, {board:[c(2,0),null,c(4,2)]}, {board:null},
  ]) assert.throws(() => analyzeDraws({...base,...invalid}));
});
