-- PYQ figures — the real diagrams/maps/circuits from the actual papers.
-- Many previous-year questions ("the circuit shown below…", a UPSC map cartoon)
-- are meaningless as text alone. Storing the figure lets a real PYQ card render
-- the question the way it appeared in the exam — the thing no generic AI can do.
--
-- Unlike chat-images (private, per-user, signed URLs), these are shared, static,
-- read-only reference content, so: a PUBLIC bucket with public read and a plain
-- public URL kept on the row. Writes are service-role only (the extraction
-- pipeline), never the app.

-- 1) Figures column on the question. A JSONB array so one question can carry more
--    than one figure, each with its public URL and optional caption/order. Kept
--    as objects (not bare strings) so a caption or crop box can be added later
--    without another migration.
--    Shape: [{ "url": "https://…/pyq-figures/upsc/2019/q42-1.png",
--              "caption": "Fig. 1", "order": 0 }]
alter table public.pyq_questions
  add column if not exists images jsonb not null default '[]'::jsonb;

-- Marks a row whose text references a figure. The extraction pipeline sets this;
-- a retrieval/quality pass can require images to be present before a figure-
-- dependent question is served, so a student never sees an unanswerable one.
alter table public.pyq_questions
  add column if not exists needs_figure boolean not null default false;

comment on column public.pyq_questions.images is
  'JSONB array of figure objects: [{url, caption, order}]. Public URLs into the pyq-figures bucket.';
comment on column public.pyq_questions.needs_figure is
  'True when the question text references a figure. Serve only if images is non-empty.';

-- 2) Public, read-only bucket. Reference content, safe to serve directly and
--    cache at the CDN — no per-user scoping, no signed URLs.
insert into storage.buckets (id, name, public)
values ('pyq-figures', 'pyq-figures', true)
on conflict (id) do nothing;

-- 3) Anyone may READ (the whole point of a public reference bucket). WRITES are
--    restricted to service_role — only the extraction pipeline uploads figures,
--    never an app client.
drop policy if exists "pyq_figures_public_read" on storage.objects;
create policy "pyq_figures_public_read" on storage.objects
  for select to public
  using (bucket_id = 'pyq-figures');

drop policy if exists "pyq_figures_service_write" on storage.objects;
create policy "pyq_figures_service_write" on storage.objects
  for insert to service_role
  with check (bucket_id = 'pyq-figures');

drop policy if exists "pyq_figures_service_update" on storage.objects;
create policy "pyq_figures_service_update" on storage.objects
  for update to service_role
  using (bucket_id = 'pyq-figures');

drop policy if exists "pyq_figures_service_delete" on storage.objects;
create policy "pyq_figures_service_delete" on storage.objects
  for delete to service_role
  using (bucket_id = 'pyq-figures');
