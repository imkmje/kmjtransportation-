import { it } from 'vitest';
import { steady, noFacelift } from '../src/sim/bots';
import { Game, allGens } from '../src/sim/game';
import { config } from '../src/config';
import { avgGrade } from '../src/sim/cars';
import { yearOf } from '../src/sim/time';
it('trace', () => {
  config.market.scale = +(process.env.SCALE ?? config.market.scale); if (process.env.PROTO) config.dev.prototypePerWeek = +process.env.PROTO;
  const bot = process.env.BOT === 'steady' ? steady() : noFacelift();
  const g = Game.create({ seed: +(process.env.SEED ?? 1) });
  for (let w = 0; w < 48 * 20 && g.state.status === 'playing'; w++) {
    bot.step(g); const ev = g.tick();
    for (const e of ev) if (e.kind === 'news' || e.kind === 'discontinued' || e.kind === 'recall' || e.kind === 'gameOver') console.log(yearOf(w), e.text);
    if (w % 24 === 23) {
      const s = g.state, y = yearOf(s.week);
      console.log(y, (w % 48 === 23 ? 'H1' : 'H2'), 'cash', Math.round(s.cash / 1e4), 'proj', s.projects.map((p) => `${p.kind}:${p.phase}${p.testWeeks}`).join(','),
        'gens', allGens(s).filter((x) => x.status !== 'discontinued').map((x) => `${x.id}#${x.number}${x.body} ed${x.editions.length} avg${avgGrade(x.editions.at(-1)!.stats, y).toFixed(1)} sales${x.sales.slice(-3).join('/')} aw${x.awareness.toFixed(2)}`).join(' | '),
        'riv', s.rivals.map((r) => r.cells.sedanS.toFixed(2)).join(','), 'staff', s.staff.map((x) => x.ability).join(','));
    }
  }
});
