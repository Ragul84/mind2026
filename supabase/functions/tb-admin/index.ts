// gte-small embedding migration admin (guarded by TB_ADMIN_TOKEN). Connects to PG
// via the auto-injected SUPABASE_DB_URL. The embedding column (embedding_gte
// vector(384)) and match_textbook_chunks_gte RPC already exist from the earlier run.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-admin-token, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
let _sql: any = null;
const getSql = () => (_sql ??= postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false }));
const toVec = (a: number[]) => `[${a.join(",")}]`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!Deno.env.get("TB_ADMIN_TOKEN") || token !== Deno.env.get("TB_ADMIN_TOKEN")!.trim()) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "status");
  const sql = getSql();
  try {
    if (action === "status") {
      const [{ total }] = await sql`SELECT count(*)::int AS total FROM textbook_chunks`;
      const [{ done }] = await sql`SELECT count(*)::int AS done FROM textbook_chunks WHERE embedding_gte IS NOT NULL`;
      return json({ ok: true, total, done, remaining: total - done });
    }
    if (action === "claimbatch") {
      const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);
      const rows = await sql`
        SELECT id, content FROM textbook_chunks
        WHERE embedding_gte IS NULL AND content IS NOT NULL AND length(content) > 0
        ORDER BY id LIMIT ${limit}`;
      return json({ ok: true, rows });
    }
    if (action === "writevecs") {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const values = rows.filter((r: any) => r && r.id != null && Array.isArray(r.vec) && r.vec.length === 384).map((r: any) => [String(r.id), toVec(r.vec)]);
      if (!values.length) return json({ ok: false, written: 0, sent: rows.length, error: "no valid rows" }, 400);
      const res = await sql`
        UPDATE textbook_chunks AS t SET embedding_gte = v.emb::vector
        FROM (VALUES ${sql(values)}) AS v(id, emb) WHERE t.id = v.id`;
      // res.count = actual rows updated — the worker checks this so a write can't fail silently.
      return json({ ok: true, written: res.count ?? values.length, sent: rows.length });
    }
    if (action === "mkstudylab") {
      // One-shot: create the study_lab_sessions table + RLS (mirrors the committed
      // migration 20260805000000_study_lab_sessions.sql). Safe to re-run.
      await sql.unsafe(`
        create table if not exists public.study_lab_sessions (
          id text primary key,
          user_id uuid not null references auth.users(id) on delete cascade,
          title text not null default 'Untitled',
          session jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create index if not exists study_lab_sessions_user_idx
          on public.study_lab_sessions (user_id, updated_at desc);
        alter table public.study_lab_sessions enable row level security;
        drop policy if exists "study_lab_select_own" on public.study_lab_sessions;
        create policy "study_lab_select_own" on public.study_lab_sessions
          for select to authenticated using (user_id = auth.uid());
        drop policy if exists "study_lab_insert_own" on public.study_lab_sessions;
        create policy "study_lab_insert_own" on public.study_lab_sessions
          for insert to authenticated with check (user_id = auth.uid());
        drop policy if exists "study_lab_update_own" on public.study_lab_sessions;
        create policy "study_lab_update_own" on public.study_lab_sessions
          for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
        drop policy if exists "study_lab_delete_own" on public.study_lab_sessions;
        create policy "study_lab_delete_own" on public.study_lab_sessions
          for delete to authenticated using (user_id = auth.uid());
      `);
      const [{ ok }] = await sql`select to_regclass('public.study_lab_sessions') is not null as ok`;
      return json({ ok: true, created: ok });
    }
    if (action === "index") {
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS textbook_chunks_embedding_gte_hnsw ON textbook_chunks USING hnsw (embedding_gte vector_cosine_ops)`);
      return json({ ok: true, indexed: true });
    }
    if (action === "install_textbook_matcher_scope") {
      await sql.unsafe(`
        drop function if exists public.match_textbook_chunks_gte(vector(384), integer, text, text);

        create function public.match_textbook_chunks_gte(
          query_embedding vector(384),
          match_count integer,
          filter_language text,
          filter_board text default null
        )
        returns table (
          id text,
          source_id text,
          board text,
          class_level integer,
          subject text,
          chapter text,
          language text,
          chunk_type text,
          content text,
          similarity double precision
        )
        language sql
        stable
        as $$
          select
            c.id,
            c.source_id,
            c.board,
            c.class_level,
            c.subject,
            c.chapter,
            c.language,
            c.chunk_type,
            c.content,
            1 - (c.embedding_gte <=> query_embedding) as similarity
          from public.textbook_chunks as c
          where c.embedding_gte is not null
            and (filter_language is null or c.language = filter_language)
            and (filter_board is null or c.board = filter_board)
          order by c.embedding_gte <=> query_embedding asc, c.id asc
          limit greatest(coalesce(match_count, 6), 1);
        $$;
      `);
      return json({ ok: true, installed: true });
    }
    if (action === "renull_v2") {
      // Optional: clear the small early batch (embedded with the slightly-off WASM
      // model) so it gets re-done with the exact native model. id list from caller.
      const ids = Array.isArray(body.ids) ? body.ids.map((x: any) => String(x)) : [];
      if (!ids.length) return json({ ok: true, cleared: 0 });
      const res = await sql`UPDATE textbook_chunks SET embedding_gte = NULL WHERE id = ANY(${ids})`;
      return json({ ok: true, cleared: res.count ?? 0 });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
