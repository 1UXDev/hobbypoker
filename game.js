import { randomInt } from 'node:crypto';

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
export class Game {
  constructor(){this.players=[];this.board=[];this.phase='waiting';this.dealer=-1;this.turn=-1;this.message='Warte auf mindestens zwei Spieler.';}
  add(id,name){if(this.players.length>=8)throw Error('Der Tisch ist voll.');if(!['waiting','finished'].includes(this.phase))throw Error('Die Hand läuft bereits.');this.players.push({id,name,chips:1000,cards:[],bet:0,total:0,folded:false});}
  next(i,predicate){for(let n=1;n<=this.players.length;n++){const j=(i+n)%this.players.length;if(predicate(this.players[j]))return j;}return -1;}
  pay(p,n){n=Math.min(n,p.chips);p.chips-=n;p.bet+=n;p.total+=n;}
  start(id){if(id!==this.players[0]?.id)throw Error('Nur der Gastgeber kann starten.');if(!['waiting','finished'].includes(this.phase))throw Error('Die Hand läuft bereits.');if(this.players.filter(p=>p.chips>0).length<2)throw Error('Mindestens zwei Spieler mit Chips benötigt.');
    this.deck=Array.from({length:52},(_,i)=>({v:2+i%13,s:Math.floor(i/13)}));for(let i=51;i>0;i--){const j=randomInt(i+1);[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]];}
    this.board=[];this.phase='preflop';this.current=20;this.minRaise=20;
    for(const p of this.players){p.handStart=p.chips;p.bet=0;p.total=0;p.folded=p.chips===0;p.acted=false;p.cards=p.folded?[]:[this.deck.pop(),this.deck.pop()];}
    this.dealer=this.next(this.dealer,p=>!p.folded);
    const sb=this.players.filter(p=>!p.folded).length===2?this.dealer:this.next(this.dealer,p=>!p.folded);
    const bb=this.next(sb,p=>!p.folded);this.pay(this.players[sb],10);this.pay(this.players[bb],20);this.turn=this.next(bb,p=>!p.folded&&p.chips>0);this.message='Neue Hand · Blinds 10 / 20';this.progress(bb);
  }
  act(id,type,amount){const p=this.players[this.turn];if(!p||p.id!==id||['waiting','finished'].includes(this.phase))throw Error('Du bist nicht am Zug.');
    if(type==='fold')p.folded=true;
    else if(type==='call')this.pay(p,Math.max(0,this.current-p.bet));
    else if(type==='raise'){
      const target=Number(amount),delta=target-this.current;
      if(!Number.isSafeInteger(target)||delta<this.minRaise||target>p.bet+p.chips)throw Error(`Erhöhe auf mindestens ${this.current+this.minRaise} Chips.`);
      this.pay(p,target-p.bet);this.minRaise=delta;this.current=target;for(const q of this.players)if(q!==p)q.acted=false;
    }else throw Error('Unbekannter Spielzug.');
    p.acted=true;this.progress(this.turn);
  }
  progress(last){
    const live=this.players.filter(p=>!p.folded);
    if(live.length===1){live[0].chips+=this.players.reduce((s,p)=>s+p.total,0);this.finish(`${live[0].name} gewinnt ohne Showdown.`);return;}
    const active=live.filter(p=>p.chips>0);
    if(active.some(p=>!p.acted||p.bet<this.current)&&!(active.length<=1&&active.every(p=>p.bet>=this.current))){this.turn=this.next(last,p=>!p.folded&&p.chips>0&&(!p.acted||p.bet<this.current));return;}
    if(this.phase==='river'){this.showdown();return;}
    this.deck.pop();const count=this.phase==='preflop'?3:1;for(let i=0;i<count;i++)this.board.push(this.deck.pop());
    this.phase=({preflop:'flop',flop:'turn',turn:'river'})[this.phase];this.current=0;this.minRaise=20;for(const p of this.players){p.bet=0;p.acted=false;}
    this.turn=this.next(this.dealer,p=>!p.folded&&p.chips>0);if(active.length<=1)this.progress(this.dealer);
  }
  showdown(){const levels=[...new Set(this.players.map(p=>p.total).filter(Boolean))].sort((a,b)=>a-b);let prev=0;const winners=new Set();
    for(const level of levels){const contributors=this.players.filter(p=>p.total>=level);const pot=(level-prev)*contributors.length;prev=level;const eligible=contributors.filter(p=>!p.folded);let best=[];let win=[];for(const p of eligible){const score=rank([...p.cards,...this.board]);const c=compare(score,best);if(c>0){best=score;win=[p];}else if(c===0)win.push(p);}
      // Uncalled excess belongs to its contributor, even if no showdown is needed.
      if(!win.length)win=contributors;
      win.sort((a,b)=>((this.players.indexOf(a)-this.dealer-1+this.players.length)%this.players.length)-((this.players.indexOf(b)-this.dealer-1+this.players.length)%this.players.length));
      win.forEach((p,i)=>{p.chips+=Math.floor(pot/win.length)+(i<pot%win.length?1:0);winners.add(p.name);});
    }this.finish(`${[...winners].join(', ')} gewinnt beim Showdown.`);}
  finish(message){this.phase='finished';this.turn=-1;this.message=message;}
  view(id){return {players:this.players.map(p=>({...p,id:undefined,cards:p.id===id||(this.phase==='finished'&&this.board.length===5&&!p.folded)?p.cards:p.cards.map(()=>null),me:p.id===id})),board:this.board,phase:this.phase,dealer:this.dealer,turn:this.turn,current:this.current??0,minRaise:this.minRaise??20,pot:this.phase==='finished'?0:this.players.reduce((s,p)=>s+p.total,0),message:this.message,host:this.players[0]?.id===id};}
}
