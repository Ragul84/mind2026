// Runs the weekly-leagues migration in an in-memory Postgres (PGlite) and checks
// cohort filling, the XP trigger, get_my_league() and the rollover.
//   npm i --no-save @electric-sql/pglite && npm run test:leagues
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const sql = readFileSync(new URL('../../supabase/migrations/20261014150000_weekly_leagues.sql', import.meta.url), 'utf8')
  // pg_cron is not available in PGlite; strip extension + schedules.
  .replace(/create extension if not exists pg_cron[^;]*;/, '')
  .replace(/do \$\$\nbegin\n  perform cron\.unschedule[\s\S]*?end \$\$;\nselect cron\.schedule\([^;]*\$\$[^$]*\$\$\);/g, '');
assert.ok(!sql.includes('cron.'), 'cron statements stripped');

await db.exec(`
  create schema auth;
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
  create role authenticated; create role anon;
  create table public.user_stats (user_id uuid primary key, total_xp int default 0);
  create table public.user_profiles (id uuid primary key, full_name text, avatar_url text, state text);
`);
await db.exec(sql);

const ids = [...Array(35)].map((_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
for (const [i, id] of ids.entries()) {
  await db.query('insert into user_stats values ($1, 0)', [id]);
  await db.query('insert into user_profiles (id, full_name) values ($1, $2)', [id, `U${i}`]);
  if (i < 34) await db.query('update user_stats set total_xp = total_xp + $2 where user_id = $1', [id, (i + 1) * 10]);
}

const cohorts = (await db.query('select member_count from league_cohorts order by created_at')).rows.map((r) => r.member_count);
assert.deepEqual(cohorts, [30, 4], '34 learners with XP fill one cohort of 30, then a second');
assert.equal((await db.query('select count(*)::int n from xp_events')).rows[0].n, 34, 'one xp_event per award');
assert.equal((await db.query(`select count(*)::int n from league_members where user_id = $1`, [ids[34]])).rows[0].n, 0, 'no XP = not in a league');

await db.exec(`select set_config('t.uid', '${ids[33]}', false)`);
let me = (await db.query('select get_my_league() j')).rows[0].j;
assert.equal(me.tier, 'bronze');
assert.equal(me.joined, true);
assert.equal(me.members[0].is_me, true, 'highest XP ranks first');

// Jump a week ahead and roll over.
await db.exec(`create or replace function public.league_current_week() returns date language sql stable as
  $$ select date_trunc('week', now() at time zone 'Asia/Kolkata')::date + 7 $$;`);
assert.equal((await db.query('select league_rollover() n')).rows[0].n, 1);
const outcomes = Object.fromEntries((await db.query('select outcome, count(*)::int n from league_members group by 1')).rows.map((r) => [r.outcome, r.n]));
assert.deepEqual(outcomes, { promoted: 11, stayed: 23 }, 'top 7 of each cohort promote; bronze cannot demote');
assert.equal((await db.query('select league_rollover() n')).rows[0].n, 0, 'rollover is idempotent');

await db.query('update user_stats set total_xp = total_xp + 5 where user_id = $1', [ids[33]]);
me = (await db.query('select get_my_league() j')).rows[0].j;
assert.equal(me.tier, 'silver');
assert.equal(me.last_outcome, 'promoted');
assert.equal(me.members.length, 1, 'new week, new silver cohort');

console.log('weekly leagues: all checks passed');
