const rendered = new WeakMap();
const SVG = 'http://www.w3.org/2000/svg';
const labels = {
  neutral: 'gelassen', thinking: 'überlegt', worried: 'besorgt',
  surprised: 'überrascht', happy: 'freut sich', sad: 'enttäuscht', focused: 'entschlossen',
};
const palettes = {
  skin: [['#efbd91', '#d79267'], ['#c58a60', '#9f6045'], ['#946044', '#72442f'], ['#f4d2ad', '#d6a17d']],
  hair: ['#362c2c', '#76543c', '#d2ab5a', '#c6c3b2', '#743e33', '#252a35'],
  shirt: ['#567b69', '#8e685b', '#696f99', '#a08747', '#648b92', '#906d88'],
};

export function appearanceFor(name, seat = 0) {
  let hash = 2166136261;
  for (const character of `${name}:${seat}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return {
    skin: palettes.skin[hash % palettes.skin.length],
    hair: palettes.hair[(hash >>> 3) % palettes.hair.length],
    shirt: palettes.shirt[(hash >>> 7) % palettes.shirt.length],
    fringe: (hash >>> 11) % 3,
    glasses: (hash >>> 14) % 4 === 0,
  };
}

/** Reactions are derived exclusively from publicly visible game events. */
export function emotionFor(game, seat) {
  const player = game.players?.[seat];
  if (!player) return 'neutral';
  if (game.phase === 'finished') {
    if (player.lastHandDelta > 0) return 'happy';
    if (player.lastHandDelta < 0) return 'sad';
    return player.winner ? 'happy' : 'neutral';
  }
  const action = game.lastAction;
  if (game.actionPending && action) {
    if (action.seat === seat) {
      if (action.type === 'fold') return 'sad';
      if (action.allIn || action.type === 'raise' || action.type === 'allin') return 'focused';
      return 'neutral';
    }
    if (player.folded) return 'neutral';
    if (action.allIn) return 'surprised';
    const paid = Math.max(0, action.amount || 0);
    const relativeToStack = paid / Math.max(1, player.chips);
    const relativeToPot = paid / Math.max(1, game.pot || 0);
    if (paid > 0 && (relativeToStack >= .15 || relativeToPot >= .3)) return 'worried';
  }
  return game.turn === seat ? 'thinking' : 'neutral';
}

function portrait(document, name, seat, emotion) {
  const look = appearanceFor(name, seat);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${name}: ${labels[emotion]}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const pixel = (x, y, width, height, color) => {
    const rect = document.createElementNS(SVG, 'rect');
    for (const [key, value] of Object.entries({x, y, width, height, fill: color})) rect.setAttribute(key, value);
    svg.append(rect);
  };
  const [skin, shade] = look.skin;
  const ink = '#292b2b';
  pixel(12, 23, 8, 6, shade);
  pixel(7, 27, 18, 5, look.shirt);
  pixel(4, 29, 24, 3, look.shirt);
  pixel(7, 9, 18, 15, skin);
  pixel(9, 6, 14, 20, skin);
  pixel(5, 13, 2, 7, shade);
  pixel(25, 13, 2, 7, shade);
  pixel(8, 4, 16, 5, look.hair);
  pixel(6, 7, 20, 4, look.hair);
  pixel(7, 10, 2, 6, look.hair);
  pixel(23, 10, 2, 6, look.hair);
  if (look.fringe === 0) { pixel(9, 9, 7, 3, look.hair); pixel(10, 12, 3, 1, look.hair); }
  if (look.fringe === 1) { pixel(17, 9, 6, 3, look.hair); pixel(20, 12, 3, 1, look.hair); }
  if (look.fringe === 2) { pixel(10, 9, 3, 2, look.hair); pixel(19, 9, 3, 2, look.hair); }
  pixel(16, 16, 2, 4, shade);

  if (emotion === 'happy') {
    pixel(10, 15, 1, 1, ink); pixel(11, 14, 2, 1, ink); pixel(13, 15, 1, 1, ink);
    pixel(19, 15, 1, 1, ink); pixel(20, 14, 2, 1, ink); pixel(22, 15, 1, 1, ink);
    pixel(11, 20, 2, 3, ink); pixel(19, 20, 2, 3, ink); pixel(13, 23, 6, 1, ink);
    pixel(13, 21, 6, 2, '#f4eee1');
  } else {
    const eyeHeight = emotion === 'surprised' ? 4 : emotion === 'thinking' ? 2 : 3;
    pixel(11, 14, 2, eyeHeight, ink); pixel(20, 14, 2, eyeHeight, ink);
    if (emotion === 'surprised') {
      pixel(10, 10, 4, 1, ink); pixel(19, 10, 4, 1, ink);
      pixel(14, 21, 5, 5, ink); pixel(15, 22, 3, 2, '#90584d');
    } else if (emotion === 'sad' || emotion === 'worried') {
      pixel(10, 11, 2, 1, ink); pixel(12, 10, 2, 1, ink);
      pixel(19, 10, 2, 1, ink); pixel(21, 11, 2, 1, ink);
      pixel(12, 23, 2, 1, ink); pixel(14, 22, 5, 1, ink); pixel(19, 23, 2, 1, ink);
      if (emotion === 'sad') { pixel(21, 18, 2, 4, '#8ec7cf'); pixel(20, 21, 3, 2, '#8ec7cf'); }
    } else if (emotion === 'focused') {
      pixel(10, 11, 2, 1, ink); pixel(12, 12, 2, 1, ink);
      pixel(19, 12, 2, 1, ink); pixel(21, 11, 2, 1, ink);
      pixel(12, 22, 9, 2, ink); pixel(13, 22, 7, 1, '#f4eee1');
    } else if (emotion === 'thinking') {
      pixel(10, 11, 4, 1, ink); pixel(19, 10, 4, 1, ink);
      pixel(13, 22, 6, 1, ink); pixel(19, 21, 2, 1, ink);
    } else {
      pixel(10, 11, 4, 1, ink); pixel(19, 11, 4, 1, ink);
      pixel(12, 22, 8, 1, ink);
    }
  }
  if (look.glasses && emotion !== 'happy') {
    pixel(9, 13, 6, 1, ink); pixel(18, 13, 6, 1, ink);
    pixel(9, 17, 6, 1, ink); pixel(18, 17, 6, 1, ink);
    pixel(9, 14, 1, 3, ink); pixel(14, 14, 1, 3, ink);
    pixel(18, 14, 1, 3, ink); pixel(23, 14, 1, 3, ink);
    pixel(15, 14, 3, 1, ink);
  }
  return svg;
}

/** Render into a stable avatar element; unrelated SSE updates do no DOM work. */
export function renderFace(container, game, seat) {
  const player = game.players?.[seat];
  if (!player) return;
  if (!player.isBot) {
    if (rendered.has(container)) { rendered.delete(container); container.replaceChildren(); }
    container.classList.remove('sprite-face', 'face-react');
    container.textContent = player.winner ? '♛' : player.name[0].toUpperCase();
    container.removeAttribute('data-emotion');
    container.removeAttribute('title');
    return;
  }
  const emotion = emotionFor(game, seat);
  const identity = `${seat}:${player.name}`;
  const event = game.phase === 'finished' ? 'result' : `${game.phase}:${game.lastAction?.sequence ?? 0}`;
  const key = `${game.handId}:${event}:${emotion}`;
  const previous = rendered.get(container);
  container.classList.add('sprite-face');
  container.dataset.emotion = emotion;
  container.title = `${player.name}: ${labels[emotion]}`;
  if (previous?.identity !== identity || previous?.emotion !== emotion) {
    container.replaceChildren(portrait(container.ownerDocument, player.name, seat, emotion));
  }
  if (previous?.key !== key) {
    container.classList.remove('face-react');
    if (previous && emotion !== 'neutral') {
      void container.offsetWidth;
      container.classList.add('face-react');
    }
  }
  rendered.set(container, {identity, emotion, key});
}
