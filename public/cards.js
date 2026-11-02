const containers = new WeakMap();
const suits = ['♠', '♥', '♦', '♣'];
const values = {11: 'J', 12: 'Q', 13: 'K', 14: 'A'};

function createCard(document) {
  const card = document.createElement('div');
  card.className = 'card dealt-card';
  card.setAttribute('role', 'img');
  const inner = document.createElement('div');
  inner.className = 'card-inner';
  inner.setAttribute('aria-hidden', 'true');
  const back = document.createElement('div');
  back.className = 'card-face card-back';
  back.textContent = '♠';
  const front = document.createElement('div');
  front.className = 'card-face card-front';
  const value = document.createElement('span');
  value.className = 'card-value';
  const suit = document.createElement('span');
  suit.className = 'card-suit';
  front.append(value, suit);
  inner.append(back, front);
  card.append(inner);
  return {card, inner, value, suit, key: undefined};
}

/**
 * Update an attached, stable card container without replaying unchanged cards.
 * A null card is face down. Board placeholders become new deals when revealed;
 * already-dealt opponent cards only flip when the showdown reveals their faces.
 */
export function renderCards(container, list, {handId, animate = true, placeholders = false} = {}) {
  let state = containers.get(container);
  if (!state || state.handId !== handId) {
    state = {handId, cards: []};
    containers.set(container, state);
    container.replaceChildren();
  }
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const motion = animate && !reduced;
  let dealt = 0;
  list.forEach((card, index) => {
    const key = card ? `${card.s}:${card.v}` : 'hidden';
    let slot = state.cards[index];
    const isNew = !slot;
    if (isNew) {
      slot = createCard(container.ownerDocument);
      state.cards[index] = slot;
      container.append(slot.card);
    }
    if (!isNew && slot.key === key) return;

    const wasHidden = slot.key === 'hidden';
    const entering = isNew ? !(placeholders && !card) : Boolean(placeholders && wasHidden && card);
    const reveal = Boolean(card);
    const delay = entering ? dealt++ * 180 : 0;
    slot.card.classList.remove('card-arriving', 'card-revealing');
    slot.card.classList.toggle('red', Boolean(card && (card.s === 1 || card.s === 2)));
    slot.card.classList.toggle('back', !reveal);
    slot.card.classList.toggle('is-revealed', reveal);
    slot.card.classList.toggle('is-placeholder', Boolean(placeholders && !reveal));
    slot.card.style.setProperty('--deal-delay', `${delay}ms`);
    slot.card.style.setProperty('--flip-delay', `${delay + (entering ? 300 : 0)}ms`);
    if (card) {
      const value = values[card.v] || String(card.v);
      slot.value.textContent = value;
      slot.suit.textContent = suits[card.s];
      slot.card.setAttribute('aria-label', `${value} ${suits[card.s]}`);
    } else {
      slot.value.textContent = '';
      slot.suit.textContent = '';
      slot.card.setAttribute('aria-label', placeholders ? 'Noch keine Karte' : 'Verdeckte Karte');
    }
    if (motion && entering) slot.card.classList.add('card-arriving');
    if (motion && reveal) slot.card.classList.add('card-revealing');
    slot.key = key;
  });
  while (state.cards.length > list.length) state.cards.pop().card.remove();
}
