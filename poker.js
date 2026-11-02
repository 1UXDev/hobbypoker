export function rank(cards) {
  let best = [];
  for (let a=0;a<cards.length-4;a++) for(let b=a+1;b<cards.length-3;b++) for(let c=b+1;c<cards.length-2;c++) for(let d=c+1;d<cards.length-1;d++) for(let e=d+1;e<cards.length;e++) {
    const hand=[cards[a],cards[b],cards[c],cards[d],cards[e]];
    const values=hand.map(x=>x.v).sort((x,y)=>y-x);
    const groups=[...new Set(values)].map(v=>[values.filter(x=>x===v).length,v]).sort((x,y)=>y[0]-x[0]||y[1]-x[1]);
    const flush=hand.every(x=>x.s===hand[0].s);
    let straight=groups.length===5&&values[0]-values[4]===4?values[0]:0;
    if(values.join(',')==='14,5,4,3,2') straight=5;
    const g=groups.map(x=>x[1]);
    const score=flush&&straight?[8,straight]:groups[0][0]===4?[7,...g]:groups[0][0]===3&&groups[1][0]===2?[6,...g]:flush?[5,...values]:straight?[4,straight]:groups[0][0]===3?[3,...g]:groups[0][0]===2&&groups[1][0]===2?[2,...g]:groups[0][0]===2?[1,...g]:[0,...values];
    if(compare(score,best)>0) best=score;
  }
  return best;
}
export function compare(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const n=(a[i]??0)-(b[i]??0);if(n)return n;}return 0;}

const HAND_NAMES = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

export function handName(score) {
  if (!score.length) return null;
  return score[0] === 8 && score[1] === 14 ? 'Royal Flush' : HAND_NAMES[score[0]];
}
