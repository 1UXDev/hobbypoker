import {quickBets} from './bets.js';
import {renderCards} from './cards.js';
import {createWinnerOverlay} from './winner-overlay.js';
import {createJournal} from './journal.js';
import {renderFace} from './faces.js';

const $ = id => document.getElementById(id);
const format = n => n.toLocaleString('de-DE');
let session, stream, state, equityWorker, equityKey, renderedResult;
let submitting = false;
let potFrame, potDisplay = 0, potTarget;
let countdownTimer, countdownAt, announcedAllIn;
let pendingAllIn, confirmingAllIn = false;
let currentDraws = [];
const winnerOverlay = createWinnerOverlay();
const journal = createJournal();
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function textElement(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
async function api(path, data = {}) {
  const response = await fetch(path, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...session, ...data}),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  $('error').textContent = '';
  return result;
}
function connect() {
  document.body.classList.add('playing');
  window.scrollTo(0, 0);
  $('lobby').hidden = true;
  $('game').hidden = false;
  $('code').textContent = session.room;
  stream?.close();
  stream = new EventSource(`/events?room=${session.room}&token=${session.token}`);
  stream.onmessage = event => {
    $('connection').textContent = '● VERBUNDEN';
    render(JSON.parse(event.data));
  };
  stream.onerror = () => { $('connection').textContent = 'VERBINDUNG WIRD HERGESTELLT'; };
}

function animatePot(target, reset = false) {
  if (potTarget === target && !reset) return;
  potTarget = target;
  cancelAnimationFrame(potFrame);
  const el = $('pot');
  el.setAttribute('aria-label', `${format(target)} Chips`);
  el.classList.remove('counting');
  if (reset || reducedMotion() || target <= potDisplay) {
    potDisplay = target;
    el.textContent = format(target);
    return;
  }
  const from = potDisplay;
  const started = performance.now();
  el.classList.add('counting');
  const tick = now => {
    const progress = Math.min(1, (now - started) / 800);
    potDisplay = Math.round(from + (target - from) * (1 - (1 - progress) ** 3));
    el.textContent = format(potDisplay);
    if (progress < 1) potFrame = requestAnimationFrame(tick);
    else el.classList.remove('counting');
  };
  potFrame = requestAnimationFrame(tick);
}

function updateEquity(game, me) {
  const el = $('equity');
  const active = !['waiting', 'finished'].includes(game.phase) && !me.folded && me.cards.length === 2;
  el.hidden = !active;
  $('show-draws').hidden = !active;
  if (!active) {
    equityKey = undefined;
    currentDraws = [];
    $('draws-dialog').close();
    equityWorker?.terminate();
    equityWorker = undefined;
    return;
  }
  const opponents = game.players.filter(p => !p.me && !p.folded).length;
  const input = {cards: me.cards, board: game.board, opponents};
  const key = JSON.stringify({handId: game.handId, ...input});
  if (key === equityKey) return;
  equityKey = key;
  currentDraws = [];
  $('draws-dialog').close();
  renderDraws([]);
  el.textContent = 'Gewinnchance wird geschätzt …';
  equityWorker?.terminate();
  try {
    equityWorker = new Worker('/equity-worker.js', {type: 'module'});
    equityWorker.onmessage = ({data}) => {
      if (data.key !== equityKey) return;
      currentDraws = data.draws || [];
      renderDraws(currentDraws);
      el.textContent = data.error ? 'Gewinnchance nicht verfügbar' : `≈ ${Math.round(data.equity * 100)} % Gewinnchance`;
    };
    equityWorker.onerror = () => {
      if (key === equityKey) el.textContent = 'Gewinnchance nicht verfügbar';
    };
    equityWorker.postMessage({key, ...input});
  } catch { el.textContent = 'Gewinnchance nicht verfügbar'; }
}

const percent = value => value.toLocaleString('de-DE', {style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1});
const rankLabel = value => ({11: 'J', 12: 'Q', 13: 'K', 14: 'A'})[value] || String(value);
function drawCards(draw) {
  if (draw.nextCardCards?.length && draw.nextCardCards.every(card => card.s === draw.nextCardCards[0].s)) {
    const suit = ['♠', '♥', '♦', '♣'][draw.nextCardCards[0].s];
    if (draw.category === 5) return ['Pik ♠', 'Herz ♥', 'Karo ♦', 'Kreuz ♣'][draw.nextCardCards[0].s];
    return draw.ranks.map(value => rankLabel(value) + suit).join(' / ');
  }
  return draw.ranks.map(rankLabel).join(' / ');
}
function renderDraws(draws) {
  const best = draws.find(draw => draw.outs > 0);
  const preview = $('show-draws');
  if (best) {
    preview.replaceChildren(
      textElement('strong', `${best.handName} · ${drawCards(best)}`),
      textElement('span', `${best.outs} Outs · ${percent(best.nextCardProbability)} nächste Karte ⓘ`),
    );
  } else preview.textContent = draws.length ? 'Mögliche Hände bis zum River ⓘ' : 'Chancen & Draws erklären ⓘ';
  $('draws-content').replaceChildren(...draws.map(draw => {
    const row = document.createElement('section');
    row.className = 'draw-row';
    row.append(
      textElement('h3', draw.handName),
      textElement('p', draw.outs ? `${draw.outs} Outs · ${drawCards(draw)}` : 'Backdoor-Draw · zwei Karten benötigt', 'draw-outs'),
      textElement('p', `Nächste Karte: ${percent(draw.nextCardProbability)}`, 'draw-probability'),
      textElement('p', `Am River: ${percent(draw.byRiverProbability)}`, 'draw-probability'),
    );
    return row;
  }));
  if (!draws.length) $('draws-content').append(textElement('p', 'Konkrete Verbesserungen werden ab dem Flop angezeigt. Am River sind keine weiteren Karten mehr offen.'));
}

function renderResult(game) {
  const result = game.result;
  $('show-result').hidden = !result;
  $('result').hidden = !result;
  if (!result) { renderedResult = undefined; return false; }
  if (renderedResult === result.handId) return false;
  renderedResult = result.handId;
  $('result').textContent = result.winners.map(winner => `${winner.name} gewinnt${winner.handName ? ` mit ${winner.handName}` : ' ohne Showdown'}.`).join(' ');
  return true;
}

function playerTile(player, seat, game, celebrate) {
  // Keep each seat and its card nodes mounted while live state changes.
  let el = $('players').children[seat];
  if (!el) {
    el = document.createElement('div');
    const bet = document.createElement('div');
    bet.className = 'player-bet';
    bet.append(textElement('span', '', 'bet-label'), textElement('strong', '', 'bet-amount'));
    const hand = document.createElement('div');
    hand.className = 'cards player-cards';
    el.append(
      textElement('div', '', 'avatar'), textElement('strong', '', 'player-name'),
      textElement('div', '', 'blind-badges'), bet, textElement('span', '', 'stack'),
      textElement('span', '', 'hand-delta'), textElement('span', '', 'overall-delta'), textElement('span', '', 'player-status'),
      hand, textElement('span', '', 'hand-name'),
    );
    $('players').append(el);
  }
  const liveAllIn = !['waiting', 'finished'].includes(game.phase) && !player.folded && player.cards.length === 2;
  el.hidden = player.chips === 0 && !liveAllIn;
  el.dataset.seat = seat;
  el.dataset.bot = String(player.isBot);
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${player.name}: Spielerstatistik öffnen`);
  el.onclick = () => journal.openPlayer(state, seat);
  el.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); journal.openPlayer(state, seat); }
  };
  const acting = game.actionPending && game.lastAction?.seat === seat;
  el.className = 'player' + (game.turn === seat || acting ? ' active' : '') + (player.folded ? ' folded' : '') + (player.winner ? ' winner' : '') + (player.winner && celebrate ? ' winner-pop' : '') + (player.chips === 0 && !player.folded && !['waiting', 'finished'].includes(game.phase) ? ' allin-seat' : '');
  renderFace(el.querySelector('.avatar'), game, seat);
  el.querySelector('.player-name').textContent = player.name + (player.me ? ' (du)' : '');
  const badges = [];
  if (game.dealer === seat) badges.push(textElement('span', 'D', 'dealer-badge'));
  if (game.smallBlind === seat) badges.push(textElement('span', 'SB 10', 'blind-badge'));
  if (game.bigBlind === seat) badges.push(textElement('span', 'BB 20', 'blind-badge'));
  el.querySelector('.blind-badges').replaceChildren(...badges);
  el.querySelector('.blind-badges').hidden = !badges.length;
  const finished = game.phase === 'finished';
  el.querySelector('.bet-label').textContent = finished ? 'In dieser Hand gesetzt' : 'Einsatz';
  el.querySelector('.bet-amount').textContent = format(finished ? player.total : player.bet);
  el.querySelector('.player-bet').hidden = game.phase === 'waiting';
  el.querySelector('.stack').textContent = `Stack: ${format(player.chips)} Chips`;
  const delta = player.lastHandDelta;
  const change = el.querySelector('.hand-delta');
  change.textContent = delta == null ? 'Letzte Hand: —' : `Letzte Hand: ${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${format(Math.abs(delta))}`;
  change.className = 'hand-delta ' + (delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral');
  const overall = player.overallDelta ?? 0;
  const overallEl = el.querySelector('.overall-delta');
  overallEl.textContent = `Gesamt: ${overall > 0 ? '+' : overall < 0 ? '−' : '±'}${format(Math.abs(overall))}`;
  overallEl.className = 'overall-delta ' + (overall > 0 ? 'positive' : overall < 0 ? 'negative' : 'neutral');
  overallEl.title = 'Gewinn oder Verlust aus allen abgeschlossenen Händen dieser Partie';
  const status = finished ? (player.folded ? 'Gepasst' : 'Hand beendet') : player.folded ? 'Gepasst' : player.chips === 0 && game.phase !== 'waiting' ? 'All-in' : game.turn === seat ? 'Am Zug' : 'Am Tisch';
  el.querySelector('.player-status').textContent = player.winner ? 'Gewonnen' : status;
  renderCards(el.querySelector('.player-cards'), player.cards, {handId: game.handId, animate: Boolean(state)});
  el.querySelector('.hand-name').textContent = player.handName || '';
  el.querySelector('.hand-name').hidden = !player.handName;
}

function updateCountdown(game) {
  const el = $('next-hand');
  if (!game.nextHandAt || game.phase !== 'finished') {
    clearInterval(countdownTimer);
    countdownAt = undefined;
    el.hidden = game.phase !== 'finished' || game.soloBusted;
    el.textContent = game.phase === 'finished' ? 'Für die nächste Hand werden mindestens zwei Spieler mit Chips benötigt.' : '';
    return;
  }
  el.hidden = false;
  if (countdownAt === game.nextHandAt) return;
  clearInterval(countdownTimer);
  countdownAt = game.nextHandAt;
  const deadline = performance.now() + Math.max(0, game.nextHandAt - game.serverNow);
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    el.textContent = seconds ? `Nächste Hand in ${seconds} s` : 'Nächste Hand startet …';
  };
  tick();
  countdownTimer = setInterval(tick, 200);
}

function renderAllIn(game) {
  const action = game.lastAction;
  const active = game.actionPending && action?.allIn;
  $('allin-notice').hidden = !active;
  $('game').classList.toggle('allin-action', Boolean(active));
  if (!active) return;
  const key = `${game.handId}:${action.sequence}`;
  if (announcedAllIn === key) return;
  announcedAllIn = key;
  $('allin-notice').replaceChildren(
    textElement('strong', 'ALL-IN'),
    textElement('span', `${game.players[action.seat].name} · ${format(action.amount)} Chips`),
  );
  $('allin-notice').classList.remove('allin-pop');
  void $('allin-notice').offsetWidth;
  $('allin-notice').classList.add('allin-pop');
}

function renderLoss(game, me) {
  const loss = game.soloBusted && me.chips === 0;
  const dialog = $('loss');
  if (loss && !dialog.open) {
    $('loss-error').textContent = '';
    dialog.showModal();
    $('restart').focus();
  } else if (!loss && dialog.open) dialog.close();
}

function renderControls(game, me) {
  const myTurn = Boolean(game.players[game.turn]?.me) && !game.actionPending;
  const betweenHands = ['waiting', 'finished'].includes(game.phase);
  $('actions').hidden = !myTurn;
  $('start').hidden = !game.host || !betweenHands || Boolean(game.nextHandAt);
  $('bot').hidden = !game.host || !betweenHands;
  $('bot').disabled = game.players.length >= 8;
  $('start').disabled = game.players.filter(p => p.chips > 0).length < 2;
  $('start').textContent = 'Hand starten ↗';
  $('call').textContent = game.current > me.bet ? `Mitgehen ${format(Math.min(me.chips, game.current - me.bet))}` : 'Check';
  const minimum = game.current + game.minRaise;
  const maximum = me.chips + me.bet;
  const context = `${game.handId}:${game.phase}:${game.current}:${me.bet}:${me.chips}`;
  const input = $('amount');
  input.min = minimum;
  input.max = maximum;
  if (input.dataset.context !== context) {
    input.value = Math.min(maximum, minimum);
    input.dataset.context = context;
  }
  const canRaise = maximum >= minimum && me.canRaise !== false;
  input.disabled = !canRaise;
  $('raise').disabled = !canRaise;
  $('allin').textContent = `All-in vorbereiten · ${format(me.chips)}`;
  $('allin').disabled = !myTurn || me.chips === 0 || (me.canRaise === false && maximum > game.current);
  $('quick-bets').replaceChildren(...quickBets(game, me).map(preset => {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = preset.disabled;
    button.append(textElement('span', preset.label), textElement('strong', preset.disabled ? '—' : format(preset.amount)));
    button.title = preset.disabled ? 'Dieser Einsatz ist gerade nicht möglich' : `Direkt auf ${preset.amount} Chips erhöhen`;
    button.onclick = run(() => submitAction('raise', preset.amount));
    return button;
  }));
}

function render(game) {
  $('game').dataset.phase = game.phase;
  const visiblePlayers = game.players.filter(player => player.chips > 0 || (!['waiting', 'finished'].includes(game.phase) && !player.folded && player.cards.length === 2)).length;
  $('game').style.setProperty('--player-columns', Math.max(1, Math.min(4, visiblePlayers)));
  $('game').style.setProperty('--player-rows', Math.max(1, Math.ceil(visiblePlayers / 4)));
  const board = [...game.board, ...Array(5 - game.board.length).fill(null)];
  renderCards($('board'), board, {handId: game.handId, animate: Boolean(state), placeholders: true});
  animatePot(game.phase === 'finished' && game.result ? game.result.pot : game.pot, !state || state.handId !== game.handId);
  $('pot-label').textContent = game.phase === 'finished' ? 'POT VERTEILT' : 'POT';
  $('phase').textContent = ({waiting: 'Warte auf Mitspieler', preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River', finished: 'Hand beendet'})[game.phase];
  $('message').textContent = game.message;
  const me = game.players.find(p => p.me);
  renderCards($('hand'), me.cards, {handId: game.handId, animate: Boolean(state)});
  $('my-hand-name').textContent = me.handName || '';
  $('my-hand-name').hidden = !me.handName;
  if (game.actionPending && game.lastAction) {
    const action = game.lastAction;
    const verb = action.allIn ? `geht All-in mit ${format(action.amount)} Chips` : action.type === 'fold' ? 'passt' : action.amount === 0 ? 'checkt' : `setzt ${format(action.amount)} Chips`;
    $('status').textContent = `${game.players[action.seat].name} ${verb}.`;
  } else {
    $('status').textContent = game.players[game.turn]?.me ? 'Du bist am Zug.' : game.turn >= 0 ? `${game.players[game.turn].name} ist am Zug${game.players[game.turn].isBot ? ' …' : '.'}` : 'Bereit für die nächste Hand?';
  }
  const celebrate = renderResult(game);
  game.players.forEach((p, seat) => playerTile(p, seat, game, celebrate));
  if (game.turn >= 0 && game.turn !== state?.turn && matchMedia('(max-width: 1099px)').matches) {
    const strip = $('players');
    const tile = strip.children[game.turn];
    const left = tile.offsetLeft - strip.offsetLeft - (strip.clientWidth - tile.offsetWidth) / 2;
    strip.scrollTo({left, behavior: reducedMotion() ? 'instant' : 'smooth'});
  }
  while ($('players').children.length > game.players.length) $('players').lastElementChild.remove();
  updateCountdown(game);
  renderAllIn(game);
  renderLoss(game, me);
  updateEquity(game, me);
  renderControls(game, me);
  state = game;
  if (pendingAllIn && actionContext(game) !== pendingAllIn.context) closeAllIn();
  if (!game.players[game.turn]?.me || game.actionPending) $('advanced-bets').open = false;
  journal.record(game);
  winnerOverlay.update(game);
}

function actionContext(game) {
  const me = game.players.find(player => player.me);
  return JSON.stringify([game.handId, game.phase, game.turn, game.actionPending, game.current, game.minRaise, game.lastAction?.sequence, me.chips, me.bet, me.canRaise]);
}

function closeAllIn() {
  pendingAllIn = undefined;
  $('confirm-allin').close();
}

function submitAction(type, amount) {
  if (!state?.players[state.turn]?.me || state.actionPending) throw Error('Du bist nicht am Zug.');
  const me = state.players.find(player => player.me);
  const paid = type === 'allin' ? me.chips : type === 'raise' ? amount - me.bet : type === 'call' ? Math.min(me.chips, Math.max(0, state.current - me.bet)) : 0;
  // Pot shortcuts can reach the stack limit too: every all-in requires intent.
  if (paid > 0 && paid === me.chips) {
    pendingAllIn = {type, amount, context: actionContext(state)};
    $('confirm-allin-description').textContent = `Alle ${format(me.chips)} verbleibenden Chips setzen?`;
    $('confirm-allin-error').textContent = '';
    $('confirm-allin-submit').textContent = `${format(me.chips)} Chips setzen`;
    $('confirm-allin').showModal();
    $('cancel-allin').focus();
    return;
  }
  return api('/action', {type, amount});
}

function run(fn) {
  return async event => {
    event?.preventDefault();
    if (submitting) return;
    submitting = true;
    try { await fn(); } catch (error) { $('error').textContent = error.message; }
    finally { submitting = false; }
  };
}
$('join').onsubmit = run(async () => {
  session = await api('/join', {name: $('name').value, room: $('room').value});
  sessionStorage.setItem('hobbypoker', JSON.stringify(session));
  connect();
});
for (const type of ['fold', 'call', 'raise', 'allin']) {
  $(type).onclick = run(() => {
    if (type === 'raise' && !$('amount').reportValidity()) return;
    return submitAction(type, Number($('amount').value));
  });
}
$('start').onclick = run(() => api('/start'));
$('bot').onclick = run(() => api('/bot'));
$('show-draws').onclick = () => { renderDraws(currentDraws); $('draws-dialog').showModal(); $('close-draws').focus(); };
$('close-draws').onclick = () => $('draws-dialog').close();
$('history').onclick = () => journal.openHistory();
$('show-result').onclick = () => winnerOverlay.open();
$('loss-show-result').onclick = () => winnerOverlay.open({allowSoloLoss: true});
$('copy').onclick = run(async () => {
  await navigator.clipboard.writeText(session.room);
  $('connection').textContent = 'RAUMCODE KOPIERT';
});
$('cancel-allin').onclick = closeAllIn;
$('confirm-allin').addEventListener('cancel', event => {
  if (confirmingAllIn) event.preventDefault();
  else pendingAllIn = undefined;
});
$('confirm-allin-submit').onclick = async () => {
  if (submitting || !pendingAllIn) return;
  if (actionContext(state) !== pendingAllIn.context) { closeAllIn(); return; }
  const action = pendingAllIn;
  submitting = true;
  confirmingAllIn = true;
  $('confirm-allin-submit').disabled = true;
  $('cancel-allin').disabled = true;
  try { await api('/action', {type: action.type, amount: action.amount}); closeAllIn(); }
  catch (error) { $('confirm-allin-error').textContent = error.message; }
  finally {
    submitting = false;
    confirmingAllIn = false;
    $('confirm-allin-submit').disabled = false;
    $('cancel-allin').disabled = false;
  }
};
try {
  session = JSON.parse(sessionStorage.getItem('hobbypoker'));
  if (session) connect();
} catch { sessionStorage.removeItem('hobbypoker'); }

$('loss').addEventListener('cancel', event => event.preventDefault());
$('restart').onclick = async () => {
  if (submitting) return;
  submitting = true;
  $('restart').disabled = true;
  $('loss-error').textContent = '';
  try { await api('/restart'); }
  catch (error) { $('loss-error').textContent = error.message; }
  finally { submitting = false; $('restart').disabled = false; }
};
