#!/usr/bin/env node
// Count completed games per day from the live twinleaf.gg match history.
//
// A "game" here = one row in the Match table, which the server writes only when a
// 2-player game reaches FINISHED with a decided winner (see match-recorder.ts).
//
// Usage:
//   AUTH_TOKEN='12345,1790000000' node tools/games-per-day.mjs [days] [timezone]
//
//   days      number of days back to include (default 30)
//   timezone  IANA tz for day bucketing      (default UTC, e.g. America/New_York)
//
// Get AUTH_TOKEN: log in at https://play.twinleaf.gg, open devtools console, run
//   copy(localStorage.token)   // then paste it as AUTH_TOKEN below

const BASE = process.env.API_URL || 'https://play-server.twinleaf.gg';
const TOKEN = process.env.AUTH_TOKEN;
const DAYS = parseInt(process.argv[2], 10) || 30;
const TZ = process.argv[3] || 'UTC';
const PAGE_SIZE = 500; // server caps page size via its own logic; 500 is plenty

if (!TOKEN) {
  console.error('Missing AUTH_TOKEN env var. See header of this file.');
  process.exit(1);
}

const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
const dayKey = (ms) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms)); // en-CA => YYYY-MM-DD

const counts = new Map();
let page = 0;
let scanned = 0;
let total = null;

for (;;) {
  const url = `${BASE}/v1/profile/matchHistory/0/${page}/${PAGE_SIZE}`;
  const res = await fetch(url, { headers: { 'Auth-Token': TOKEN } });
  if (!res.ok) {
    console.error(`HTTP ${res.status} on page ${page}`);
    process.exit(1);
  }
  const data = await res.json();
  if (data.error) {
    console.error(`API error: ${data.error}`);
    process.exit(1);
  }
  if (total === null) total = data.total;
  const matches = data.matches || [];
  if (matches.length === 0) break;

  let reachedCutoff = false;
  for (const m of matches) {
    const created = Number(m.created);
    scanned++;
    if (created < cutoff) { reachedCutoff = true; break; }
    counts.set(dayKey(created), (counts.get(dayKey(created)) || 0) + 1);
  }
  // matches are ordered created DESC, so once we pass the cutoff we're done
  if (reachedCutoff || matches.length < PAGE_SIZE) break;
  page++;
}

const rows = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
const inWindow = rows.reduce((s, [, n]) => s + n, 0);

console.log(`\nGames per day (last ${DAYS} days, tz=${TZ})`);
console.log('date         games');
console.log('----------   -----');
for (const [day, n] of rows) {
  console.log(`${day}   ${String(n).padStart(5)}  ${'#'.repeat(Math.min(n, 60))}`);
}
console.log('----------   -----');
console.log(`total in window: ${inWindow}   (all-time matches on server: ${total})`);
