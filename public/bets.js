// Targets are total street bets, not extra chips to add.
export function quickBets(game, player) {
  const minimum = game.current + game.minRaise;
  const maximum = player.bet + player.chips;
  const call = Math.max(0, game.current - player.bet);
  const size = fraction => game.current + Math.ceil((game.pot + call) * fraction);
  return [
    {label: '½ Pot', target: size(.5)},
    {label: 'Pot', target: size(1)},
    {label: '2× Einsatz', target: game.current * 2, unavailable: game.current === 0},
  ].map(preset => ({
    ...preset,
    amount: Math.min(maximum, Math.max(minimum, preset.target)),
    disabled: Boolean(preset.unavailable || maximum < minimum || player.canRaise === false),
  }));
}
