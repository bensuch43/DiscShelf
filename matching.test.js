import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseMatch, matchEntries, applyMatches, pick, unmatch, matchSummary, needsMatch } from './matching.js';
import { addEntries, newCollection, parseTitleList, matches } from './collections.js';

const m = (tmdbId, title, year, mediaType = 'movie') => ({ tmdbId, title, year, mediaType, posterPath: `/${tmdbId}.jpg` });
const PINOCCHIO = [m(532321, 'Pinocchio', 2022), m(10895, 'Pinocchio', 1940), m(555604, "Guillermo del Toro's Pinocchio", 2022), m(2, 'Pinocchio', 2002)];
const LION = [m(8587, 'The Lion King', 1994), m(420818, 'The Lion King', 2019), m(9, 'The Lion King II: Simba\'s Pride', 1998)];

test('year picks the right remake', () => {
  assert.equal(chooseMatch({ title: 'Pinocchio', year: 1940 }, PINOCCHIO).match.tmdbId, 10895);
  assert.equal(chooseMatch({ title: 'The Lion King', year: 2019 }, LION).match.tmdbId, 420818);
  assert.equal(chooseMatch({ title: 'Lion King', year: 1995 }, LION).match.tmdbId, 8587); // ±1 year, leading "The" ignored
});

test('no year: unique exact title matches; remakes ask', () => {
  assert.equal(chooseMatch({ title: 'Fantasia 2000' }, [m(49948, 'Fantasia 2000', 1999), m(756, 'Fantasia', 1940)]).match.tmdbId, 49948);
  const r = chooseMatch({ title: 'The Lion King' }, LION);
  assert.equal(r.state, 'ambiguous');
  assert.deepEqual(r.candidates.map((c) => c.tmdbId), [8587, 420818]);
});

test('a film beats a TV series of the same name', () => {
  assert.equal(chooseMatch({ title: 'Fargo' }, [m(275, 'Fargo', 1996), m(60622, 'Fargo', 2014, 'tv')]).match.tmdbId, 275);
});

test('short title with a year and one candidate in range matches; people ignored; nothing -> not found', () => {
  assert.equal(chooseMatch({ title: 'Snow White', year: 1937 }, [m(408, 'Snow White and the Seven Dwarfs', 1937), m(447273, 'Snow White', 2025)]).match.tmdbId, 408);
  assert.equal(chooseMatch({ title: 'X' }, [{ tmdbId: 1, title: 'X', mediaType: 'person' }]).state, 'notfound');
  assert.equal(chooseMatch({ title: 'Nope' }, []).state, 'notfound');
  assert.equal(chooseMatch({ title: 'Unrelated' }, [m(1, 'Something else', 2000)]).state, 'ambiguous');
});

test('matchEntries runs concurrently, skips matched entries, and stops on a bad status', async () => {
  const c = addEntries(newCollection('D'), [...parseTitleList('Pinocchio (1940)\nThe Lion King\nNothing Here'), m(1, 'Already', 2000)]).collection;
  let active = 0;
  let peak = 0;
  const search = async (q) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return { status: 'ok', results: q === 'Pinocchio' ? PINOCCHIO : q === 'The Lion King' ? LION : [] };
  };
  const progress = [];
  const { results, stopped, total } = await matchEntries(c.entries, search, { concurrency: 2, onProgress: (d, t) => progress.push(`${d}/${t}`) });
  assert.equal(total, 3);
  assert.equal(stopped, null);
  assert.ok(peak <= 2);
  assert.deepEqual(progress.at(-1), '3/3');
  const applied = applyMatches(c, results);
  assert.deepEqual(matchSummary(applied), { matched: 2, ambiguous: 1, notfound: 1, skipped: 0, pending: 0 });
  const pin = applied.entries[0];
  assert.equal(pin.title, 'Pinocchio'); // your title is kept
  assert.equal(pin.tmdbTitle, 'Pinocchio');
  assert.equal(pin.posterPath, '/10895.jpg');
  assert.ok(matches(pin, { title: 'Totally different', tmdbId: 10895, mediaType: 'movie' }));
  // A disc without a TMDB id matches by either your title or TMDB's title.
  const snow = pick({ id: 's', title: 'Snow White', year: 1937 }, m(408, 'Snow White and the Seven Dwarfs', 1937));
  assert.ok(matches(snow, { title: 'Snow White and the Seven Dwarfs', year: 1937 }));
  assert.ok(matches(snow, { title: 'Snow White' }));
  assert.equal(applied.entries.filter(needsMatch).length, 0);

  const stop = await matchEntries(c.entries, async () => ({ status: 'nokey', results: [] }));
  assert.equal(stop.stopped.status, 'nokey');
  assert.equal(stop.results.size, 0);
});

test('pick and unmatch', () => {
  const e = { id: 'a', title: 'The Lion King', year: null, matchState: 'ambiguous', candidates: LION };
  const chosen = pick(e, LION[1]);
  assert.equal(chosen.tmdbId, 420818);
  assert.equal(chosen.year, 2019);
  assert.equal(chosen.candidates, undefined);
  const cleared = unmatch(chosen, 'skipped');
  assert.equal(cleared.tmdbId, null);
  assert.equal(cleared.matchState, 'skipped');
  assert.equal(cleared.year, 2019);
  assert.equal(needsMatch(unmatch(chosen)), true);
});
