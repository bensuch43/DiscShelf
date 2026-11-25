import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normTitle, matches, parseTitleList, addEntries, progress, entryStatus, collectionsContaining, setMembership,
  enrichEntries, newCollection, sortEntries, checklistText,
} from './collections.js';
import { validateBackup, BACKUP_FORMAT } from './backup.js';

const disney = () => addEntries(newCollection('Disney Classics'), parseTitleList(
  '1. Snow White and the Seven Dwarfs (1937)\n2. Pinocchio (1940)\n3. Fantasia (1940)\n4. Dumbo (1941)\nFantasia 2000\n',
)).collection;

test('normTitle ignores case, accents, punctuation, & and leading articles', () => {
  assert.equal(normTitle('The Lion King'), normTitle('lion king'));
  assert.equal(normTitle('Beauty & the Beast'), normTitle('Beauty and the Beast'));
  assert.equal(normTitle('Amélie'), 'amelie');
  assert.equal(normTitle('Snow White: and the Seven Dwarfs'), normTitle('Snow White and the Seven Dwarfs'));
});

test('matching: TMDB id wins; otherwise title, with year when both have one', () => {
  assert.ok(matches({ title: 'Fantasia', year: 1940 }, { title: 'FANTASIA', year: 1940 }));
  assert.ok(matches({ title: 'Fantasia', year: null }, { title: 'Fantasia', year: 1940 }));
  assert.ok(!matches({ title: 'Fantasia', year: 1940 }, { title: 'Fantasia 2000', year: 1999 }));
  assert.ok(!matches({ title: 'The Lion King', year: 1994 }, { title: 'The Lion King', year: 2019 }));
  assert.ok(matches({ title: 'X', tmdbId: 5 }, { title: 'Different title', tmdbId: 5 }));
  assert.ok(!matches({ title: 'Same', tmdbId: 5 }, { title: 'Same', tmdbId: 6 }));
  assert.ok(!matches({ title: 'Same', tmdbId: 5, mediaType: 'tv' }, { title: 'Same', tmdbId: 5, mediaType: 'movie' }));
});

test('parseTitleList: numbering, bullets, bracketed or separated years; bare numbers stay in titles', () => {
  assert.deepEqual(parseTitleList('1. Snow White (1937)\n- Pinocchio, 1940\n* Dumbo - 1941\nFantasia 2000\n1917\nRobin Hood [1973]\n\nPinocchio (1940)'), [
    { title: 'Snow White', year: 1937 },
    { title: 'Pinocchio', year: 1940 },
    { title: 'Dumbo', year: 1941 },
    { title: 'Fantasia 2000', year: null },
    { title: '1917', year: null },
    { title: 'Robin Hood', year: 1973 },
  ]);
});

test('addEntries skips duplicates and keeps list order', () => {
  const c = disney();
  assert.equal(c.entries.length, 5);
  const r = addEntries(c, [{ title: 'Dumbo', year: 1941 }, { title: 'Bambi', year: 1942 }]);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(sortEntries(r.collection.entries, 'list').map((e) => e.title).slice(-2), ['Fantasia 2000', 'Bambi']);
  assert.deepEqual(sortEntries(r.collection.entries, 'year').map((e) => e.year), [1937, 1940, 1940, 1941, 1942, null]);
});

test('progress and status: one disc ticks entries in several collections; bought wants are ignored', () => {
  const c = disney();
  const animation = addEntries(newCollection('1940s animation'), [{ title: 'Pinocchio', year: 1940 }]).collection;
  const items = [{ id: 'i1', title: 'Pinocchio', year: 1940, format: 'Blu-ray' }, { id: 'i2', title: 'Pinocchio', year: 1940, format: '4K UHD' }];
  const wants = [{ id: 'w1', title: 'Dumbo', status: 'wanted' }, { id: 'w2', title: 'Fantasia', year: 1940, status: 'bought' }];
  assert.deepEqual(progress(c, items, wants), { total: 5, owned: 1, wanted: 1, missing: 3 });
  assert.equal(entryStatus(c.entries[1], items, wants).owned.length, 2);
  assert.deepEqual(collectionsContaining(items[0], [c, animation]).map((x) => x.name), ['Disney Classics', '1940s animation']);
  const text = checklistText(c, items, wants);
  assert.match(text, /^Disney Classics: 1 of 5 owned/);
  assert.match(text, /✓ Pinocchio \(1940\) \[Blu-ray, 4K UHD\]/);
  assert.match(text, /☆ Dumbo \(1941\)/);
  assert.match(text, /✗ Fantasia 2000/);
});

test('setMembership ticks and unticks; enrichEntries copies TMDB details onto pasted titles', () => {
  const c = disney();
  const bambi = { title: 'Bambi', year: 1942, tmdbId: 3170, mediaType: 'movie', posterPath: '/b.jpg' };
  const withBambi = setMembership(c, bambi, true);
  assert.equal(withBambi.entries.at(-1).tmdbId, 3170);
  assert.equal(setMembership(withBambi, bambi, true), withBambi);
  assert.equal(setMembership(withBambi, bambi, false).entries.length, 5);
  const enriched = enrichEntries(c, [{ title: 'Pinocchio', year: 1940, tmdbId: 10895, posterPath: '/p.jpg' }]);
  assert.equal(enriched.entries[1].tmdbId, 10895);
  assert.equal(enriched.entries[1].posterPath, '/p.jpg');
  assert.equal(enrichEntries(enriched, []), enriched);
});

test('backups validate collections; schema 1 backups still restore', () => {
  assert.deepEqual(validateBackup({ format: BACKUP_FORMAT, schema: 2, collections: [disney()] }), []);
  assert.deepEqual(validateBackup({ format: BACKUP_FORMAT, schema: 1, items: [] }), []);
  assert.ok(validateBackup({ format: BACKUP_FORMAT, schema: 2, collections: [{ id: 'x' }] }).length);
});
