create table if not exists public.courses (
  id text primary key,
  title text not null,
  instructor text,
  description text,
  imported_at timestamptz,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id text primary key,
  course_id text not null references public.courses(id) on delete cascade,
  type text not null default 'video',
  tag text,
  title text not null,
  module text,
  description text,
  duration text,
  duration_seconds numeric,
  source text,
  video text,
  file text,
  drive_file_id text,
  drive_web_view_link text,
  drive_web_content_link text,
  drive_preview_url text,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lessons_course_position_idx on public.lessons(course_id, position);
create index if not exists lessons_course_module_idx on public.lessons(course_id, module);

create table if not exists public.watch_progress (
  device_id text not null,
  lesson_id text not null references public.lessons(id) on delete cascade,
  done boolean not null default false,
  completed_at timestamptz,
  position_seconds numeric,
  duration_seconds numeric,
  percent numeric,
  updated_at timestamptz not null default now(),
  primary key (device_id, lesson_id)
);

create index if not exists watch_progress_lesson_idx on public.watch_progress(lesson_id);

create table if not exists public.app_secrets (
  name text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.watch_progress enable row level security;
alter table public.app_secrets enable row level security;

drop policy if exists "Public courses are readable" on public.courses;
create policy "Public courses are readable"
on public.courses for select
to anon, authenticated
using (true);

drop policy if exists "Public lessons are readable" on public.lessons;
create policy "Public lessons are readable"
on public.lessons for select
to anon, authenticated
using (true);

drop policy if exists "Device progress is readable by device" on public.watch_progress;
create policy "Device progress is readable by device"
on public.watch_progress for select
to anon, authenticated
using (device_id = current_setting('request.headers', true)::json->>'x-device-id');

drop policy if exists "Device progress is insertable by device" on public.watch_progress;
create policy "Device progress is insertable by device"
on public.watch_progress for insert
to anon, authenticated
with check (device_id = current_setting('request.headers', true)::json->>'x-device-id');

drop policy if exists "Device progress is updatable by device" on public.watch_progress;
create policy "Device progress is updatable by device"
on public.watch_progress for update
to anon, authenticated
using (device_id = current_setting('request.headers', true)::json->>'x-device-id')
with check (device_id = current_setting('request.headers', true)::json->>'x-device-id');

revoke all on public.app_secrets from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.courses, public.lessons to anon, authenticated;
grant select, insert, update on public.watch_progress to anon, authenticated;
