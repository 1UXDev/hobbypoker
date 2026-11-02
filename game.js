import { randomInt } from 'node:crypto';

import { rank, compare, handName } from './poker.js';
export { rank, compare } from './poker.js';

export class Game {
  constructor(){this.players=[];this.board=[];this.handId=0;this.result=null;this.lastAction=null;this.actionSequence=0;this.pendingAdvance=null;this.phase='waiting';this.dealer=-1;this.turn=-1;this.message='Warte auf mindestens zwei Spieler.';}
  add(id,name){if(this.players.length>=8)throw Error('Der Tisch ist voll.');if(!['waiting','finished'].includes(this.phase))throw Error('Die Hand läuft bereits.');this.players.push({id,name,chips:1000,cards:[],bet:0,total:0,folded:false,lastHandDelta:null});}
  next(i,predicate){for(let n=1;n<=this.players.length;n++){const j=(i+n)%this.players.length;if(predicate(this.players[j]))return j;}return -1;}
  pay(p,n){n=Math.min(n,p.chips);p.chips-=n;p.bet+=n;p.total+=n;}
  start(id){if(id!==this.players[0]?.id)throw Error('Nur der Gastgeber kann starten.');if(this.pendingAdvance!==null||!['waiting','finished'].includes(this.phase))throw Error('Die Hand läuft bereits.');if(this.players.filter(p=>p.chips>0).length<2)throw Error('Mindestens zwei Spieler mit Chips benötigt.');
    this.deck=Array.from({length:52},(_,i)=>({v:2+i%13,s:Math.floor(i/13)}));for(let i=51;i>0;i--){const j=randomInt(i+1);[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]];}
    this.handId++;this.result=null;this.lastAction=null;this.actionSequence=0;this.pendingAdvance=null;
    this.board=[];this.phase='preflop';this.current=20;this.minRaise=20;
    for(const p of this.players){p.handStart=p.chips;p.bet=0;p.total=0;p.folded=p.chips===0;p.acted=false;p.cards=p.folded?[]:[this.deck.pop(),this.deck.pop()];}
    this.dealer=this.next(this.dealer,p=>!p.folded);
    const sb=this.players.filter(p=>!p.folded).length===2?this.dealer:this.next(this.dealer,p=>!p.folded);
    const bb=this.next(sb,p=>!p.folded);this.pay(this.players[sb],10);this.pay(this.players[bb],20);this.turn=this.next(bb,p=>!p.folded&&p.chips>0);this.message='Neue Hand · Blinds 10 / 20';this.progress(bb);
  }
  act(id,type,amount,{deferProgress=false}={}){const seat=this.turn,p=this.players[seat];if(this.pendingAdvance!==null||!p||p.id!==id||['waiting','finished'].includes(this.phase))throw Error('Du bist nicht am Zug.');
    const before=p.chips;
    if(type==='fold')p.folded=true;
    else if(type==='call')this.pay(p,Math.max(0,this.current-p.bet));
    else if(type==='raise'){
      const target=Number(amount),delta=target-this.current;
      if(!Number.isSafeInteger(target)||delta<this.minRaise||target>p.bet+p.chips)throw Error(`Erhöhe auf mindestens ${this.current+this.minRaise} Chips.`);
      this.pay(p,target-p.bet);this.minRaise=delta;this.current=target;for(const q of this.players)if(q!==p)q.acted=false;
    }else throw Error('Unbekannter Spielzug.');
    p.acted=true;this.lastAction={sequence:++this.actionSequence,seat,type:type==='call'&&before===p.chips?'check':type,amount:before-p.chips,target:p.bet};
    if(deferProgress){this.pendingAdvance=seat;this.turn=-1;}else this.progress(seat);
  }
  advance(){if(this.pendingAdvance===null)return false;const last=this.pendingAdvance;this.pendingAdvance=null;this.progress(last);return true;}
  progress(last){
    const live=this.players.filter(p=>!p.folded);
    if(live.length===1){this.settle('fold');return;}
    const active=live.filter(p=>p.chips>0);
    if(active.some(p=>!p.acted||p.bet<this.current)&&!(active.length<=1&&active.every(p=>p.bet>=this.current))){this.turn=this.next(last,p=>!p.folded&&p.chips>0&&(!p.acted||p.bet<this.current));return;}
    if(this.phase==='river'){this.showdown();return;}
    this.deck.pop();const count=this.phase==='preflop'?3:1;for(let i=0;i<count;i++)this.board.push(this.deck.pop());
    this.phase=({preflop:'flop',flop:'turn',turn:'river'})[this.phase];this.current=0;this.minRaise=20;for(const p of this.players){p.bet=0;p.acted=false;}
    this.turn=this.next(this.dealer,p=>!p.folded&&p.chips>0);if(active.length<=1)this.progress(this.dealer);
  }
  showdown(){this.settle('showdown');}

  settle(reason) {
    const levels = [...new Set(this.players.map(p => p.total).filter(Boolean))].sort((a,b) => a-b);
    const result = {handId:this.handId, reason, pot:0, winners:[], refunds:[]};
    const scores = new Map();
    if (reason === 'showdown') {
      for (const p of this.players) if (!p.folded) scores.set(p, rank([...p.cards, ...this.board]));
    }
    const credit = (entries, player, amount, label) => {
      if (!amount) return;
      player.chips += amount;
      const seat = this.players.indexOf(player);
      const existing = entries.find(entry => entry.seat === seat);
      if (existing) existing.amount += amount;
      else entries.push({seat, name:player.name, amount, ...(label === undefined ? {} : {handName:label})});
    };
    let previous = 0;
    for (const level of levels) {
      const contributors = this.players.filter(p => p.total >= level);
      const layer = level-previous;
      const pot = layer*contributors.length;
      previous = level;
      // A bet that nobody matched is returned, not counted as a won side pot.
      if (contributors.length === 1) {
        credit(result.refunds, contributors[0], pot);
        continue;
      }
      const eligible = reason === 'fold'
        ? this.players.filter(p => !p.folded)
        : contributors.filter(p => !p.folded);
      // This cannot occur in normal play, but never award a pot to folded hands.
      if (!eligible.length) {
        for (const p of contributors) credit(result.refunds, p, layer);
        continue;
      }
      let winners = eligible;
      if (reason === 'showdown') {
        const best = eligible.reduce((score,p) => compare(scores.get(p),score)>0 ? scores.get(p) : score, []);
        winners = eligible.filter(p => compare(scores.get(p),best) === 0);
      }
      // Odd chips go clockwise from the button, starting with its left neighbour.
      const order = p => (this.players.indexOf(p)-this.dealer-1+this.players.length)%this.players.length;
      winners.sort((a,b) => order(a)-order(b));
      result.pot += pot;
      winners.forEach((p,i) => credit(result.winners, p,
        Math.floor(pot/winners.length)+(i<pot%winners.length ? 1 : 0),
        reason === 'showdown' ? handName(scores.get(p)) : null));
    }
    this.result = result;
    const text = result.winners.map(p => reason === 'showdown' ? `${p.name} (${p.handName})` : p.name).join(', ');
    this.finish(reason === 'showdown' ? `${text} gewinnt beim Showdown.` : `${text} gewinnt ohne Showdown.`);
  }

  finish(message) {
    this.phase='finished';this.turn=-1;this.pendingAdvance=null;this.message=message;
    for (const p of this.players) p.lastHandDelta = p.chips-(p.handStart ?? p.chips);
  }

  view(id) {
    return {
      players:this.players.map((p,seat) => {
        const me = p.id === id;
        const shown = me || (this.phase === 'finished' && this.result?.reason === 'showdown' && !p.folded);
        return {
          name:p.name, chips:p.chips, bet:p.bet, total:p.total, folded:p.folded,
          cards:shown ? p.cards : p.cards.map(() => null), me, isBot:Boolean(p.bot),
          lastHandDelta:p.lastHandDelta,
          winner:Boolean(this.result?.winners.some(winner => winner.seat === seat)),
          handName:shown && p.cards.length === 2 && this.board.length >= 3
            ? handName(rank([...p.cards, ...this.board])) : null,
        };
      }),
      board:this.board,phase:this.phase,dealer:this.dealer,turn:this.turn,
      current:this.current??0,minRaise:this.minRaise??20,
      pot:this.phase==='finished'?0:this.players.reduce((s,p)=>s+p.total,0),
      message:this.message,host:this.players[0]?.id===id,handId:this.handId,result:this.result,
      lastAction:this.lastAction,actionPending:this.pendingAdvance!==null,actingSeat:this.pendingAdvance??-1,
    };
  }
}
