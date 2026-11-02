import {quickBets} from './bets.js';

const $ = id => document.getElementById(id);
const suits = ['♠', '♥', '♦', '♣'];
const format = n => n.toLocaleString('de-DE');
let session, stream, state, equityWorker, equityKey, renderedResult;
let submitting = false;
let potFrame, potDisplay = 0, potTarget;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function card(c) {
  const el = document.createElement('div');
  el.className = 'card' + (c && (c.s === 1 || c.s === 2) ? ' red' : '') + (!c ? ' back' : '');
  if (c) {
    const value = ({11: 'J', 12: 'Q', 13: 'K', 14: 'A'})[c.v] || String(c.v);
    el.append(value);
    const suit = document.createElement('span');
    suit.textContent = suits[c.s];
    el.append(suit);
    el.setAttribute('aria-label', `${value} ${suits[c.s]}`);
  } else {
    el.textContent = '♠';
    el.setAttribute('aria-label', 'Verdeckte Karte');
  }
  return el;
}
function cards(el, list) { el.replaceChildren(...list.map(card)); }
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
  if (!active) {
    equityKey = undefined;
    equityWorker?.terminate();
    equityWorker = undefined;
    return;
  }
  const opponents = game.players.filter(p => !p.me && !p.folded).length;
  const input = {cards: me.cards, board: game.board, opponents};
  const key = JSON.stringify({handId: game.handId, ...input});
  if (key === equityKey) return;
  equityKey = key;
  el.textContent = 'Gewinnchance wird geschätzt …';
  equityWorker?.terminate();
  try {
    equityWorker = new Worker('/equity-worker.js', {type: 'module'});
    equityWorker.onmessage = ({data}) => {
      if (data.key !== equityKey) return;
      el.textContent = data.error ? 'Gewinnchance nicht verfügbar' : `≈ ${Math.round(data.equity * 100)} % Gewinnchance`;
    };
    equityWorker.onerror = () => {
      if (key === equityKey) el.textContent = 'Gewinnchance nicht verfügbar';
    };
    equityWorker.postMessage({key, ...input});
  } catch { el.textContent = 'Gewinnchance nicht verfügbar'; }
}

function renderResult(game) {
  const result = game.result;
  const el = $('result');
  el.hidden = !result;
  if (!result) {
    renderedResult = undefined;
    el.classList.remove('celebrate');
    return false;
  }
  if (renderedResult === result.handId) return false;
  renderedResult = result.handId;
  const heading = textElement('h3', result.winners.length > 1 ? 'Die Gewinner dieser Hand' : 'Die Hand ist entschieden.');
  const rows = result.winners.map(winner => {
    const row = document.createElement('div');
    row.className = 'result-winner';
    row.append(
      textElement('strong', `${winner.name} gewinnt`),
      textElement('span', winner.handName || 'Alle anderen haben gepasst', 'result-hand'),
      textElement('span', `${format(winner.amount)} Chips aus dem Pot`, 'result-amount'),
    );
    return row;
  });
  const trophy = textElement('span', '♠', 'winner-emblem');
  trophy.setAttribute('aria-hidden', 'true');
  const content = document.createElement('div');
  content.append(heading, ...rows);
  el.replaceChildren(trophy, content);
  el.classList.remove('celebrate');
  void el.offsetWidth;
  el.classList.add('celebrate');
  if (state && state.phase !== 'finished') {
    el.scrollIntoView({block: 'nearest', behavior: reducedMotion() ? 'instant' : 'smooth'});
  }
  return true;
}

function playerTile(player, seat, game, celebrate) {
  const el = document.createElement('div');
  const acting = game.actionPending && game.lastAction?.seat === seat;
  el.className = 'player' + (game.turn === seat || acting ? ' active' : '') + (player.folded ? ' folded' : '') + (player.winner ? ' winner' : '') + (player.winner && celebrate ? ' winner-pop' : '');
  const avatar = textElement('div', player.winner ? '♛' : player.name[0].toUpperCase(), 'avatar');
  const name = textElement('strong', player.name + (player.me ? ' (du)' : '') + (game.dealer === seat ? ' · D' : ''), 'player-name');
  const balance = textElement('span', `${format(player.chips)} Chips`, 'stack');
  const delta = player.lastHandDelta;
  const change = textElement('span', delta == null ? 'Letzte Hand: —' : `Letzte Hand: ${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${format(Math.abs(delta))}`, 'hand-delta ' + (delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral'));
  const status = game.phase === 'finished' ? (player.folded ? 'Gepasst' : 'Hand beendet') : player.folded ? 'Gepasst' : player.chips === 0 && game.phase !== 'waiting' ? 'All-in' : `Einsatz ${format(player.bet)}`;
  el.append(avatar, name, balance, change, textElement('span', player.winner ? 'Gewonnen' : status, 'player-status'));
  if (player.cards.length) {
    const hand = document.createElement('div');
    hand.className = 'cards player-cards';
    cards(hand, player.cards);
    el.append(hand);
    if (player.handName) el.append(textElement('span', player.handName, 'hand-name'));
  }
  return el;
}

function renderControls(game, me) {
  const myTurn = Boolean(game.players[game.turn]?.me) && !game.actionPending;
  const betweenHands = ['waiting', 'finished'].includes(game.phase);
  $('actions').hidden = !myTurn;
  $('start').hidden = !game.host || !betweenHands;
  $('bot').hidden = !game.host || !betweenHands;
  $('bot').disabled = game.players.length >= 8;
  $('start').disabled = game.players.filter(p => p.chips > 0).length < 2;
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
  const canRaise = maximum >= minimum;
  input.disabled = !canRaise;
  $('raise').disabled = !canRaise;
  $('quick-bets').replaceChildren(...quickBets(game, me).map(preset => {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = preset.disabled;
    button.append(textElement('span', preset.label), textElement('strong', preset.disabled ? '—' : format(preset.amount)));
    button.title = preset.disabled ? 'Dieser Einsatz ist gerade nicht möglich' : `Erhöhen auf ${preset.amount} Chips auswählen`;
    button.onclick = () => {
      input.value = preset.amount;
      for (const sibling of $('quick-bets').children) sibling.setAttribute('aria-pressed', String(sibling === button));
    };
    button.setAttribute('aria-pressed', 'false');
    return button;
  }));
}

function render(game) {
  cards($('board'), game.board);
  while ($('board').children.length < 5) $('board').append(card(null));
  animatePot(game.phase === 'finished' && game.result ? game.result.pot : game.pot, !state || state.handId !== game.handId);
  $('pot-label').textContent = game.phase === 'finished' ? 'POT VERTEILT' : 'POT';
  $('phase').textContent = ({waiting: 'Warte auf Mitspieler', preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River', finished: 'Hand beendet'})[game.phase];
  $('message').textContent = game.message;
  const me = game.players.find(p => p.me);
  cards($('hand'), me.cards);
  $('my-hand-name').textContent = me.handName || '';
  $('my-hand-name').hidden = !me.handName;
  if (game.actionPending && game.lastAction) {
    const action = game.lastAction;
    const verb = action.type === 'fold' ? 'passt' : action.amount === 0 ? 'checkt' : `setzt ${format(action.amount)} Chips`;
    $('status').textContent = `${game.players[action.seat].name} ${verb}.`;
  } else {
    $('status').textContent = game.players[game.turn]?.me ? 'Du bist am Zug.' : game.turn >= 0 ? `${game.players[game.turn].name} ist am Zug${game.players[game.turn].isBot ? ' …' : '.'}` : 'Bereit für die nächste Hand?';
  }
  const celebrate = renderResult(game);
  $('players').replaceChildren(...game.players.map((p, seat) => playerTile(p, seat, game, celebrate)));
  updateEquity(game, me);
  renderControls(game, me);
  state = game;
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
for (const type of ['fold', 'call', 'raise']) {
  $(type).onclick = run(() => {
    if (type === 'raise' && !$('amount').reportValidity()) return;
    return api('/action', {type, amount: Number($('amount').value)});
  });
}
$('start').onclick = run(() => api('/start'));
$('bot').onclick = run(() => api('/bot'));
$('copy').onclick = run(async () => {
  await navigator.clipboard.writeText(session.room);
  $('connection').textContent = 'RAUMCODE KOPIERT';
});
try {
  session = JSON.parse(sessionStorage.getItem('hobbypoker'));
  if (session) connect();
} catch { sessionStorage.removeItem('hobbypoker'); }
