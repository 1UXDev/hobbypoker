import {rank, compare} from '../poker.js';
import {renderCards} from './cards.js';

/** Select the actual best five, preserving where each public card came from. */
export function bestFiveCards(hole, board) {
  if (!Array.isArray(hole) || hole.length !== 2 || hole.some(card => !card) ||
      !Array.isArray(board) || board.length !== 5 || board.some(card => !card)) return [];
  const available = [
    ...hole.map(card => ({card, source: 'hole'})),
    ...board.map(card => ({card, source: 'board'})),
  ];
  let best = [], score = [];
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++)
    for (let c = b + 1; c < 5; c++) for (let d = c + 1; d < 6; d++)
      for (let e = d + 1; e < 7; e++) {
        const hand = [available[a], available[b], available[c], available[d], available[e]];
        const next = rank(hand.map(entry => entry.card));
        if (compare(next, score) > 0) { best = hand; score = next; }
      }
  return best;
}

function displayOrder(combination) {
  const score = rank(combination.map(entry => entry.card));
  const straight = score[0] === 4 || score[0] === 8;
  if (straight) {
    const value = entry => score[1] === 5 && entry.card.v === 14 ? 1 : entry.card.v;
    return combination.slice().sort((a, b) => value(a) - value(b));
  }
  const counts = new Map();
  for (const entry of combination) counts.set(entry.card.v, (counts.get(entry.card.v) || 0) + 1);
  return combination.slice().sort((a, b) => counts.get(b.card.v) - counts.get(a.card.v) || b.card.v - a.card.v);
}

const format = amount => amount.toLocaleString('de-DE');
function text(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

export function createWinnerOverlay() {
  const dialog = document.createElement('dialog');
  dialog.id = 'winner-overlay';
  dialog.className = 'wo-dialog';
  dialog.setAttribute('aria-labelledby', 'wo-title');
  dialog.setAttribute('aria-describedby', 'wo-countdown');
  const topbar = document.createElement('div');
  topbar.className = 'wo-topbar';
  const title = text('h2', 'Die Gewinnerhand', 'wo-title');
  title.id = 'wo-title';
  const closeButton = text('button', 'Schließen ×', 'wo-close');
  closeButton.type = 'button';
  closeButton.autofocus = true;
  topbar.append(title, closeButton);
  const body = document.createElement('div');
  body.className = 'wo-body';
  const countdown = text('p', '', 'wo-countdown');
  countdown.id = 'wo-countdown';
  countdown.setAttribute('role', 'timer');
  dialog.append(topbar, body, countdown);
  document.body.append(dialog);

  let game, renderedHand, autoOpenedHand, deadlineKey, timer, manualSoloLoss = false;

  function close() {
    manualSoloLoss = false;
    if (dialog.open) dialog.close();
  }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', () => { if (!dialog.open) manualSoloLoss = false; });

  function open({allowSoloLoss = false} = {}) {
    if (!game || game.phase !== 'finished' || !game.result) return false;
    const soloLoss = game.soloBusted || document.getElementById('loss')?.open;
    if (soloLoss && !allowSoloLoss) return false;
    if (soloLoss && allowSoloLoss) manualSoloLoss = true;
    if (!dialog.open) {
      dialog.showModal();
      closeButton.focus();
    }
    return true;
  }

  function winnerSection(winner) {
    const section = document.createElement('section');
    section.className = 'wo-winner';
    const isShowdown = game.result.reason === 'showdown';
    const player = game.players[winner.seat];
    const type = isShowdown ? winner.handName || 'Showdown' : 'Ohne Showdown';
    section.append(
      text('p', 'GEWINNER', 'wo-eyebrow'),
      text('h3', winner.name, 'wo-name'),
      text('p', type, 'wo-hand-type'),
      text('p', `${format(winner.amount)} Chips aus dem Pot`, 'wo-payout'),
    );

    const holes = document.createElement('div');
    holes.className = 'cards wo-hole-cards';
    const publicCards = player?.cards?.length === 2 ? player.cards : [null, null];
    renderCards(holes, publicCards, {handId: game.handId, animate: false});
    section.append(text('p', 'SPIELERKARTEN', 'wo-label'), holes);

    if (!isShowdown) {
      section.append(text('p', 'Alle anderen haben gepasst. Die Hand wurde nicht aufgedeckt.', 'wo-note'));
      return section;
    }
    const combination = bestFiveCards(publicCards, game.board);
    if (!combination.length) {
      section.append(text('p', 'Die Gewinnerkarten sind nicht aufgedeckt.', 'wo-note'));
      return section;
    }
    const row = document.createElement('div');
    row.className = 'wo-combination';
    row.setAttribute('role', 'list');
    for (const entry of displayOrder(combination)) {
      const choice = document.createElement('div');
      choice.className = `wo-card-choice wo-from-${entry.source}`;
      choice.setAttribute('role', 'listitem');
      const cards = document.createElement('div');
      cards.className = 'cards wo-best-card';
      renderCards(cards, [entry.card], {handId: game.handId, animate: false});
      choice.append(cards, text('span', entry.source === 'hole' ? 'Hand' : 'Board', 'wo-origin'));
      row.append(choice);
    }
    section.append(text('p', 'DIE BESTEN FÜNF KARTEN', 'wo-label'), row);
    if (combination.every(entry => entry.source === 'board')) {
      section.append(text('p', 'Das Board spielt: Die besten fünf Karten liegen auf dem Tisch.', 'wo-note'));
    }
    return section;
  }

  function updateCountdown() {
    const key = `${game.handId}:${game.nextHandAt}`;
    if (deadlineKey === key) return;
    clearInterval(timer);
    deadlineKey = key;
    if (!game.nextHandAt) {
      countdown.textContent = 'Hand beendet · Du kannst dieses Fenster schließen.';
      return;
    }
    const remaining = Math.max(0, game.nextHandAt - game.serverNow);
    const deadline = performance.now() + remaining;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      countdown.textContent = seconds ? `Nächste Hand in ${seconds} s · Schließen jederzeit möglich` : 'Die nächste Hand startet …';
    };
    tick();
    timer = setInterval(tick, 200);
  }

  function update(next) {
    game = next;
    if (game.phase !== 'finished' || !game.result) {
      close();
      clearInterval(timer);
      deadlineKey = undefined;
      return;
    }
    if (renderedHand !== game.result.handId) {
      if (manualSoloLoss) close();
      manualSoloLoss = false;
      renderedHand = game.result.handId;
      title.textContent = game.result.winners.length > 1 ? 'Die Gewinner dieser Hand' : 'Die Gewinnerhand';
      body.replaceChildren(...game.result.winners.map(winnerSection));
    }
    updateCountdown();
    if (game.soloBusted) {
      if (!manualSoloLoss) close();
      autoOpenedHand = game.result.handId;
      return;
    }
    if (autoOpenedHand !== game.result.handId && open()) autoOpenedHand = game.result.handId;
  }

  return {update, open, close};
}
