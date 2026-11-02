import {renderCards} from './cards.js';

export const STORAGE_KEY = 'hobbypoker.journal.v1';
export const MAX_HANDS = 300;
const validCard = c => c && Number.isInteger(c.v) && c.v >= 2 && c.v <= 14 && Number.isInteger(c.s) && c.s >= 0 && c.s < 4;
const copyCard = c => validCard(c) ? {v:c.v,s:c.s} : null;
const integer = (n,fallback=0) => Number.isSafeInteger(n) ? n : fallback;
const seatNumber = n => Number.isInteger(n) && n >= 0 && n < 8;
const actionTypes = new Set(['fold','check','call','raise','allin','smallBlind','bigBlind','blind']);
const streets = new Set(['preflop','flop','turn','river']);
const handNames = new Set(['High Card','One Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush']);
const clone = value => JSON.parse(JSON.stringify(value));

/** Copy an explicit, non-secret schema. Hidden cards are never reconstructed. */
export function normalizeHand(input, viewerSeat = input?.viewerSeat) {
  if (!input || typeof input.matchId !== 'string' || !input.matchId || input.matchId.length > 128 ||
      !Number.isSafeInteger(input.handId) || input.handId < 1 || !seatNumber(viewerSeat) ||
      !Array.isArray(input.players) || input.players.length < 1 || input.players.length > 8 ||
      !Array.isArray(input.board) || ![0,3,4,5].includes(input.board.length) || input.board.some(c=>!validCard(c)) ||
      !['showdown','fold'].includes(input.result?.reason)) return null;
  const seen = new Set();
  const players = [];
  for (const p of input.players) {
    if (!p || !seatNumber(p.seat) || seen.has(p.seat) || typeof p.name !== 'string') return null;
    seen.add(p.seat);
    const visible = p.seat === viewerSeat || (input.result.reason === 'showdown' && !p.folded);
    const holes = Array.isArray(p.holeCards) && p.holeCards.length === 2 ? p.holeCards : [];
    players.push({seat:p.seat,name:p.name.slice(0,64),isBot:Boolean(p.isBot),
      startingChips:integer(p.startingChips),endingChips:integer(p.endingChips),total:integer(p.total),folded:Boolean(p.folded),
      netChips:integer(p.netChips,integer(p.endingChips)-integer(p.startingChips)),
      holeCards:holes.map(card=>visible?copyCard(card):null)});
  }
  if (!seen.has(viewerSeat)) return null;
  const startedAt = integer(input.startedAt), endedAt = integer(input.endedAt);
  if (startedAt < 0 || endedAt < startedAt) return null;
  const copyAction = action => {
    if (!action || !seen.has(action.seat) || !actionTypes.has(action.type)) return null;
    return {sequence:integer(action.sequence),seat:action.seat,street:streets.has(action.street)?action.street:'preflop',
      type:action.type,amount:integer(action.amount),target:integer(action.target),allIn:Boolean(action.allIn),
      potBefore:integer(action.potBefore),pot:integer(action.pot),stackBefore:integer(action.stackBefore),stackAfter:integer(action.stackAfter),
      toCall:integer(action.toCall),currentBetBefore:integer(action.currentBetBefore),minRaiseBefore:integer(action.minRaiseBefore),
      board:Array.isArray(action.board)?action.board.filter(validCard).slice(0,5).map(copyCard):[],at:integer(action.at)};
  };
  const copyAwards = (entries,named) => Array.isArray(entries) ? entries.filter(entry=>entry&&seen.has(entry.seat)).map(entry=>({
    seat:entry.seat,name:players.find(p=>p.seat===entry.seat).name,amount:integer(entry.amount),
    ...(named?{handName:handNames.has(entry.handName)?entry.handName:null}:{}),
  })) : [];
  return {schemaVersion:1,matchId:input.matchId,handId:input.handId,viewerSeat,startedAt,endedAt,
    dealer:seatNumber(input.dealer)?input.dealer:-1,smallBlind:seatNumber(input.smallBlind)?input.smallBlind:-1,bigBlind:seatNumber(input.bigBlind)?input.bigBlind:-1,
    blinds:{small:integer(input.blinds?.small,10),big:integer(input.blinds?.big,20)},
    blindPosts:(Array.isArray(input.blindPosts)?input.blindPosts:[]).map(copyAction).filter(Boolean),players,
    board:input.board.map(copyCard),actions:(Array.isArray(input.actions)?input.actions:[]).slice(0,1000).map(copyAction).filter(Boolean),
    result:{handId:input.handId,reason:input.result.reason,pot:integer(input.result.pot),winners:copyAwards(input.result.winners,true),refunds:copyAwards(input.result.refunds,false)}};
}
const handKey = h => `${h.matchId}:${h.handId}:${h.viewerSeat}`;

const newGeneration = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function readEnvelope(raw) {
  const saved = JSON.parse(raw);
  if (saved?.version !== 1 || !Array.isArray(saved.hands) ||
      saved.generation !== undefined && typeof saved.generation !== 'string') throw Error('Unbekanntes Speicherformat');
  const unique = new Map();
  for (const item of saved.hands) { const hand = normalizeHand(item); if (hand) unique.set(handKey(hand), hand); }
  return {generation:saved.generation || 'initial',enabled:saved.enabled !== false,
    prunedCount:Math.max(0,integer(saved.prunedCount)),hands:[...unique.values()],
    clearedKeys:Array.isArray(saved.clearedKeys)?saved.clearedKeys.filter(key=>typeof key==='string'&&key.length<200).slice(-1000):[],
    invalid:unique.size !== saved.hands.length};
}

export class JournalStore {
  constructor({storage,key=STORAGE_KEY,maxHands=MAX_HANDS}={}) {
    this.storage=storage;this.key=key;this.maxHands=Math.max(1,Math.min(1000,integer(maxHands,MAX_HANDS)));
    this.enabled=true;this.hands=[];this.prunedCount=0;this.status='';this.persistent=Boolean(storage);
    this.readOnly=false;this.seen=new Set();this.generation='initial';this.clearedKeys=new Set();this.hadPersisted=false;
    this.refresh();
  }
  // localStorage has no compare-and-swap. Refresh before each mutation merges
  // sequential stale-tab writes; a clear generation prevents resurrected hands.
  refresh() {
    if(!this.storage){this.persistent=false;this.status='Lokale Speicherung ist nicht verfügbar. Die Aufzeichnung bleibt in dieser Sitzung.';return false;}
    try {
      const raw=this.storage.getItem(this.key);
      if(!raw){
        if(this.hadPersisted){
          for(const key of this.seen)this.clearedKeys.add(key);
          this.hands=[];this.seen.clear();this.prunedCount=0;this.generation=newGeneration();this.hadPersisted=false;
        }
        return true;
      }
      const saved=readEnvelope(raw);
      if(saved.generation!==this.generation){
        // Discard local pre-clear snapshots, including unsaved quota entries.
        for(const key of this.seen)this.clearedKeys.add(key);
        this.hands=[];this.seen.clear();this.prunedCount=0;this.generation=saved.generation;
      }
      for(const key of saved.clearedKeys)this.clearedKeys.add(key);
      const merged=new Map(this.hands.filter(hand=>!this.clearedKeys.has(handKey(hand))).map(hand=>[handKey(hand),hand]));
      for(const hand of saved.hands){
        const key=handKey(hand);
        if(!this.clearedKeys.has(key)&&(!this.seen.has(key)||merged.has(key)))merged.set(key,hand);
        this.seen.add(key);
      }
      this.hands=[...merged.values()].sort((a,b)=>a.endedAt-b.endedAt);
      const excess=Math.max(0,this.hands.length-this.maxHands);
      this.prunedCount=Math.max(this.prunedCount,saved.prunedCount)+excess;
      this.hands=this.hands.slice(excess);this.enabled=saved.enabled;
      this.readOnly=false;this.hadPersisted=true;
      if(saved.invalid)this.status='Einige ungültige Historieneinträge wurden nicht geladen.';
      return true;
    }catch{
      this.readOnly=true;this.persistent=false;
      this.status='Die vorhandene Historie ist nicht lesbar oder gesperrt. Neue Hände bleiben in dieser Sitzung; vorhandene Daten werden nicht überschrieben.';
      return false;
    }
  }
  persist() {
    if(this.readOnly||!this.storage){this.persistent=false;return false;}
    try {
      this.storage.setItem(this.key,JSON.stringify({version:1,generation:this.generation,enabled:this.enabled,
        prunedCount:this.prunedCount,clearedKeys:[...this.clearedKeys].slice(-1000),hands:this.hands}));
      this.persistent=true;this.hadPersisted=true;this.status='';return true;
    }catch{
      this.persistent=false;this.status='Browserspeicher voll oder gesperrt. Neue Hände sind nur für diese Sitzung verfügbar. Exportiere deine Historie als JSON.';return false;
    }
  }
  save(){this.refresh();return this.persist();}
  add(input,viewerSeat) {
    this.refresh();
    if(!this.enabled)return false;
    const hand=normalizeHand(input,viewerSeat);
    if(!hand||this.seen.has(handKey(hand))||this.clearedKeys.has(handKey(hand)))return false;
    this.seen.add(handKey(hand));
    // Do not evict newer stored hands when reconnecting to a very old hand.
    if(this.hands.length>=this.maxHands&&hand.endedAt<this.hands[0].endedAt)return false;
    this.hands.push(hand);this.hands.sort((a,b)=>a.endedAt-b.endedAt);
    if(this.hands.length>this.maxHands){const count=this.hands.length-this.maxHands;this.hands.splice(0,count);this.prunedCount+=count;}
    this.persist();return true;
  }
  setEnabled(enabled){this.refresh();this.enabled=Boolean(enabled);this.persist();}
  clear(){
    this.refresh();
    for(const key of this.seen)this.clearedKeys.add(key);
    this.hands=[];this.seen.clear();this.prunedCount=0;this.generation=newGeneration();this.readOnly=false;this.status='';
    this.persist();
  }
  snapshot(){this.refresh();return {enabled:this.enabled,hands:clone(this.hands),prunedCount:this.prunedCount,persistent:this.persistent,status:this.status};}
}

/** Descriptive observed-play statistics, never a claim of optimal strategy. */
export function summarize(records,{matchId,seat}={}) {
  const stats={handsPlayed:0,wins:0,losses:0,breakeven:0,netChips:0,wonChips:0,lostChips:0,
    vpipHands:0,pfrHands:0,preflopFolds:0,postflopRaises:0,postflopCalls:0,allInHands:0,showdowns:0};
  const seen=new Set();
  for(const hand of records){
    if(matchId&&hand.matchId!==matchId)continue;
    const target=seat??hand.viewerSeat;
    const player=hand.players.find(p=>p.seat===target);
    const key=`${hand.matchId}:${hand.handId}:${target}`;
    if(!player||player.holeCards.length!==2||seen.has(key))continue;
    seen.add(key);stats.handsPlayed++;
    const net=player.netChips;stats.netChips+=net;
    if(net>0){stats.wins++;stats.wonChips+=net;}else if(net<0){stats.losses++;stats.lostChips-=net;}else stats.breakeven++;
    const actions=hand.actions.filter(a=>a.seat===target);
    const voluntary=actions.filter(a=>a.amount>0&&['call','raise','allin'].includes(a.type));
    if(voluntary.some(a=>a.street==='preflop'))stats.vpipHands++;
    if(actions.some(a=>a.street==='preflop'&&(a.type==='raise'||a.type==='allin'&&a.target>a.currentBetBefore)))stats.pfrHands++;
    if(actions.some(a=>a.street==='preflop'&&a.type==='fold'))stats.preflopFolds++;
    if(actions.some(a=>a.allIn||a.type==='allin'))stats.allInHands++;
    for(const action of actions.filter(a=>a.street!=='preflop')){
      if(action.type==='raise'||action.type==='allin'&&action.target>action.currentBetBefore)stats.postflopRaises++;
      else if(action.amount>0&&(action.type==='call'||action.type==='allin'))stats.postflopCalls++;
    }
    if(hand.result.reason==='showdown'&&!player.folded)stats.showdowns++;
  }
  stats.winRate=stats.handsPlayed?stats.wins/stats.handsPlayed:0;
  stats.vpip=stats.handsPlayed?stats.vpipHands/stats.handsPlayed:0;
  stats.pfr=stats.handsPlayed?stats.pfrHands/stats.handsPlayed:0;
  stats.aggressionFactor=stats.postflopCalls?stats.postflopRaises/stats.postflopCalls:null;
  stats.style=stats.handsPlayed<20?'Noch zu wenig Hände':`${stats.vpip>.4?'Eher loose':stats.vpip<.22?'Eher tight':'Mittlere Spielbreite'} / ${stats.vpip>0&&stats.pfr/stats.vpip>.55?'aggressiv':'eher passiv'}`;
  stats.observations=[];
  if(stats.handsPlayed<20)stats.observations.push('Kleine Stichprobe: Die Werte beschreiben nur diese Hände und erlauben noch keine belastbare Stileinstufung.');
  else {
    if(stats.vpip-stats.pfr>.25)stats.observations.push('Viele Einstiege erfolgen per Call. Prüfe diese Hände nach Position, gegnerischem Einsatz und Pot Odds.');
    if(stats.preflopFolds/stats.handsPlayed>.75)stats.observations.push('Du foldest sehr häufig vor dem Flop. Schau dir besonders günstige Blind-Verteidigungen in der Historie an.');
    if(stats.postflopCalls>5&&stats.aggressionFactor<.5)stats.observations.push('Nach dem Flop überwiegen Calls gegenüber Raises. Vergleiche starke Hände und Draws in diesen Situationen.');
    if(stats.allInHands/stats.handsPlayed>.2)stats.observations.push('Viele Hände enthalten ein All-in. Prüfe dabei Stacktiefe und die Einsatzfolge vor dem All-in.');
    if(!stats.observations.length)stats.observations.push('Vergleiche gewonnene und verlorene Hände nach Position und Einsatzgröße. Aus den Häufigkeiten allein folgt keine optimale Spielweise.');
  }
  return stats;
}

const format=n=>Number(n||0).toLocaleString('de-DE');
const signed=n=>`${n>0?'+':n<0?'−':'±'}${format(Math.abs(n||0))}`;
const percent=n=>`${Math.round((n||0)*100)} %`;
const streetNames={preflop:'Pre-Flop',flop:'Flop',turn:'Turn',river:'River'};
const actionNames={fold:'passt',check:'checkt',call:'geht mit',raise:'erhöht',allin:'geht All-in',smallBlind:'Small Blind',bigBlind:'Big Blind',blind:'Blind'};
function text(tag,content,className){const node=document.createElement(tag);node.textContent=content;if(className)node.className=className;return node;}
function cardRow(list,className='jr-cards') {const el=document.createElement('div');el.className=`cards ${className}`;renderCards(el,list,{handId:0,animate:false});return el;}
function metric(label,value){const el=document.createElement('div');el.className='jr-metric';el.append(text('strong',value),text('span',label));return el;}

export function createJournal({storage}={}) {
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
  const store=new JournalStore({storage});
  const dialog=document.createElement('dialog');dialog.id='journal';dialog.className='jr-dialog';dialog.setAttribute('aria-labelledby','jr-title');
  const bar=document.createElement('div');bar.className='jr-topbar';const title=text('h2','Deine lokale Spielhistorie');title.id='jr-title';
  const closeButton=text('button','Schließen ×');closeButton.id='jr-close';closeButton.type='button';closeButton.autofocus=true;bar.append(title,closeButton);
  const controls=document.createElement('div');controls.className='jr-controls';
  const label=document.createElement('label');const enabled=document.createElement('input');enabled.type='checkbox';enabled.id='jr-enabled';enabled.checked=store.enabled;label.append(enabled,document.createTextNode(' Lokal aufzeichnen'));
  const exportButton=text('button','JSON exportieren');exportButton.id='jr-export';exportButton.type='button';
  const clearButton=text('button','Historie löschen');clearButton.id='jr-clear';clearButton.type='button';controls.append(label,exportButton,clearButton);
  const clearRow=document.createElement('div');clearRow.className='jr-clear-confirm';clearRow.hidden=true;
  const yes=text('button','Lokale Historie endgültig löschen');yes.id='jr-confirm-clear';yes.type='button';
  const no=text('button','Abbrechen');no.id='jr-cancel-clear';no.type='button';clearRow.append(text('p','Nur die gespeicherten Daten dieses Browsers werden gelöscht.'),no,yes);
  const status=text('p','', 'jr-storage-status');status.setAttribute('role','status');
  const content=document.createElement('div');content.className='jr-content';
  dialog.append(bar,controls,clearRow,status,content);document.body.append(dialog);
  let mode='history',currentGame,currentSeat,selectedKey;
  function storageStatus(){enabled.checked=store.enabled;status.textContent=[store.enabled?'Aufzeichnung aktiv.':'Aufzeichnung pausiert.',`${store.hands.length} / ${store.maxHands} Hände lokal.`,store.prunedCount?`${store.prunedCount} ältere Hände wurden aus der begrenzten Historie entfernt.`:'',store.status].filter(Boolean).join(' ');}
  function statsPanel(stats,heading){const section=document.createElement('section');section.className='jr-stats';section.append(text('h3',heading));const grid=document.createElement('div');grid.className='jr-metrics';grid.append(metric('Gewonnen / verloren',`${format(stats.wins)} : ${format(stats.losses)}`),metric('Netto-Chips',signed(stats.netChips)),metric('Gewonnene Hände',`${percent(stats.handsPlayed?stats.wins/stats.handsPlayed:0)} (${format(stats.wins)}/${format(stats.handsPlayed)})`),metric('Unverändert',format(stats.breakeven)),metric('Gewonnene / verlorene Chips',`${format(stats.wonChips)} : ${format(stats.lostChips)}`));section.append(grid);return section;}
  function patterns(stats){const section=document.createElement('section');section.className='jr-patterns';section.append(text('h3','Beobachtete Setzmuster'),text('p',`${stats.style} · ${stats.handsPlayed} aufgezeichnete Hände`, 'jr-note'));
    const grid=document.createElement('div');grid.className='jr-metrics';grid.append(metric('VPIP · freiwillig Pre-Flop Chips eingesetzt',`${percent(stats.vpip)} (${stats.vpipHands}/${stats.handsPlayed})`),metric('PFR · Pre-Flop erhöht',`${percent(stats.pfr)} (${stats.pfrHands}/${stats.handsPlayed})`),metric('Post-Flop Raises / Calls',`${stats.postflopRaises} / ${stats.postflopCalls}`),metric('Aggressionsfaktor',stats.aggressionFactor===null?(stats.postflopRaises?'Keine Calls als Nenner':'—'):stats.aggressionFactor.toFixed(2)));
    section.append(grid,...stats.observations.map(line=>text('p',line,'jr-note')));return section;
  }
  function details(hand){const section=document.createElement('section');section.className='jr-detail';section.append(text('h3',`Hand #${hand.handId}`),text('p',new Date(hand.endedAt).toLocaleString('de-DE'), 'jr-note'));
    if(hand.board.length)section.append(text('h4','Board'),cardRow(hand.board));
    const players=document.createElement('div');players.className='jr-player-hands';
    for(const p of hand.players){if(!p.holeCards.length)continue;const row=document.createElement('div');row.append(text('strong',`${p.name}${p.seat===hand.viewerSeat?' (du)':''} · ${signed(p.netChips)} Chips`),cardRow(p.holeCards),text('span',p.holeCards.some(c=>!c)?'Karten nicht aufgedeckt':`Stack ${format(p.startingChips)} → ${format(p.endingChips)}`, 'jr-note'));players.append(row);}
    section.append(players,text('h4','Einsatzfolge'));
    const list=document.createElement('ol');list.className='jr-actions';
    const sequence=[...hand.blindPosts,...hand.actions];
    for(const action of sequence){const p=hand.players.find(p=>p.seat===action.seat);const item=document.createElement('li');item.className=action.seat===hand.viewerSeat?'jr-own-action':'';item.append(text('strong',`${streetNames[action.street]} · ${p?.name||'Spieler'}`),text('span',`${actionNames[action.type]}${action.amount?` ${format(action.amount)} Chips`:''}${action.type==='raise'||action.type==='allin'?` · Ziel ${format(action.target)}`:''}${action.allIn&&action.type!=='allin'?' · All-in':''} · Pot ${format(action.pot)}`));list.append(item);}
    section.append(list,text('p','Verdeckte Gegnerkarten sind nicht bekannt und werden nicht nachträglich geraten. Die exportierte JSON enthält zusätzlich Board-, Stack- und Pot-Werte je Aktion.','jr-note'));return section;
  }
  function render(){storageStatus();content.replaceChildren();clearRow.hidden=true;
    if(mode==='player'){
      const player=currentGame?.players.find((p,i)=>(p.seat??i)===currentSeat);
      title.textContent=`${player?.name||'Spieler'} · Statistik`;
      const observed=summarize(store.hands,{matchId:currentGame?.matchId,seat:currentSeat});
      const stats=player?.stats||observed;content.append(statsPanel(stats,'Diese Partie'),text('p','Gewinn und Verlust beziehen sich auf die Nettoänderung einer abgeschlossenen Hand; geteilte oder ausgeglichene Hände können unverändert enden.','jr-note'),patterns(observed));
      const history=text('button','Gesamte eigene Historie ansehen');history.type='button';history.onclick=()=>{mode='history';render();};content.append(history);return;
    }
    title.textContent='Deine lokale Spielhistorie';
    const stats=summarize(store.hands);content.append(statsPanel(stats,'Deine aufgezeichneten Hände'),patterns(stats));
    if(!store.hands.length){content.append(text('p','Die erste abgeschlossene Hand wird automatisch gespeichert. Deine Karten, öffentlich aufgedeckte Gegnerkarten und die Einsatzfolge bleiben nur in diesem Browser.','jr-note'));return;}
    const split=document.createElement('div');split.className='jr-history-layout';const list=document.createElement('div');list.className='jr-hand-list';list.setAttribute('aria-label','Aufgezeichnete Hände');
    const selected=store.hands.find(h=>handKey(h)===selectedKey)||store.hands.at(-1);selectedKey=handKey(selected);
    for(const hand of [...store.hands].reverse()){const me=hand.players.find(p=>p.seat===hand.viewerSeat);const button=text('button',`#${hand.handId} · ${me?.name||'Du'} · ${signed(me?.netChips)}`);button.type='button';button.setAttribute('aria-pressed',String(handKey(hand)===selectedKey));button.onclick=()=>{selectedKey=handKey(hand);render();};list.append(button);}
    split.append(list,details(selected));content.append(split);
  }
  function open(){store.refresh();render();if(!dialog.open)dialog.showModal();closeButton.focus();}
  closeButton.onclick=()=>dialog.close();
  enabled.onchange=()=>{store.setEnabled(enabled.checked);storageStatus();};
  clearButton.onclick=()=>{clearRow.hidden=false;no.focus();};no.onclick=()=>{clearRow.hidden=true;clearButton.focus();};yes.onclick=()=>{store.clear();selectedKey=undefined;render();};
  exportButton.onclick=()=>{const data={schemaVersion:1,exportedAt:new Date().toISOString(),scope:'Locally observed completed hands; hidden opponent cards remain unknown',...store.snapshot()};delete data.status;delete data.persistent;
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`hobbypoker-history-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
  return {store,
    record(game){try{if(!game.completedHand||game.phase!=='finished')return false;const viewer=game.players.findIndex(p=>p.me);const seat=game.players[viewer]?.seat??viewer;const added=store.add(game.completedHand,seat);if(added&&dialog.open&&mode==='history')render();return added;}catch{store.status='Diese Hand konnte nicht aufgezeichnet werden. Das Spiel läuft weiter.';return false;}},
    openPlayer(game,seat){mode='player';currentGame=game;currentSeat=seat;open();},
    openHistory(){mode='history';open();},close(){dialog.close();},
  };
}
