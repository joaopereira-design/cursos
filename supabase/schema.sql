create table if not exists public.courses (
  owner_id text not null default 'local-owner',
  id text not null,
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
  owner_id text not null default 'local-owner',
  id text not null,
  course_id text not null,
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

create table if not exists public.watch_progress (
  owner_id text not null default 'local-owner',
  device_id text not null,
  lesson_id text not null,
  done boolean not null default false,
  completed_at timestamptz,
  position_seconds numeric,
  duration_seconds numeric,
  percent numeric,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_secrets (
  owner_id text not null default 'local-owner',
  name text not null,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.courses add column if not exists owner_id text not null default 'local-owner';
alter table public.lessons add column if not exists owner_id text not null default 'local-owner';
alter table public.watch_progress add column if not exists owner_id text not null default 'local-owner';
alter table public.app_secrets add column if not exists owner_id text not null default 'local-owner';

alter table public.lessons drop constraint if exists lessons_course_id_fkey;
alter table public.watch_progress drop constraint if exists watch_progress_lesson_id_fkey;
alter table public.courses drop constraint if exists courses_pkey;
alter table public.lessons drop constraint if exists lessons_pkey;
alter table public.watch_progress drop constraint if exists watch_progress_pkey;
alter table public.app_secrets drop constraint if exists app_secrets_pkey;

alter table public.courses add constraint courses_pkey primary key (owner_id, id);
alter table public.lessons add constraint lessons_pkey primary key (owner_id, id);
alter table public.watch_progress add constraint watch_progress_pkey primary key (owner_id, device_id, lesson_id);
alter table public.app_secrets add constraint app_secrets_pkey primary key (owner_id, name);

alter table public.lessons
  add constraint lessons_course_owner_fk
  foreign key (owner_id, course_id)
  references public.courses(owner_id, id)
  on delete cascade;

alter table public.watch_progress
  add constraint watch_progress_lesson_owner_fk
  foreign key (owner_id, lesson_id)
  references public.lessons(owner_id, id)
  on delete cascade;

create index if not exists courses_owner_position_idx on public.courses(owner_id, position, title);
create index if not exists lessons_owner_course_position_idx on public.lessons(owner_id, course_id, position);
create index if not exists lessons_owner_course_module_idx on public.lessons(owner_id, course_id, module);
create index if not exists watch_progress_owner_lesson_idx on public.watch_progress(owner_id, lesson_id);

alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.watch_progress enable row level security;
alter table public.app_secrets enable row level security;

drop policy if exists "Public courses are readable" on public.courses;
drop policy if exists "Public lessons are readable" on public.lessons;
drop policy if exists "Device progress is readable by device" on public.watch_progress;
drop policy if exists "Device progress is insertable by device" on public.watch_progress;
drop policy if exists "Device progress is updatable by device" on public.watch_progress;

drop policy if exists "Owner courses are readable" on public.courses;
create policy "Owner courses are readable"
on public.courses for select
to anon, authenticated
using (owner_id = current_setting('request.headers', true)::json->>'x-owner-id');

drop policy if exists "Owner lessons are readable" on public.lessons;
create policy "Owner lessons are readable"
on public.lessons for select
to anon, authenticated
using (owner_id = current_setting('request.headers', true)::json->>'x-owner-id');

drop policy if exists "Owner progress is readable by device" on public.watch_progress;
create policy "Owner progress is readable by device"
on public.watch_progress for select
to anon, authenticated
using (
  owner_id = current_setting('request.headers', true)::json->>'x-owner-id'
  and device_id = current_setting('request.headers', true)::json->>'x-device-id'
);

drop policy if exists "Owner progress is insertable by device" on public.watch_progress;
create policy "Owner progress is insertable by device"
on public.watch_progress for insert
to anon, authenticated
with check (
  owner_id = current_setting('request.headers', true)::json->>'x-owner-id'
  and device_id = current_setting('request.headers', true)::json->>'x-device-id'
);

drop policy if exists "Owner progress is updatable by device" on public.watch_progress;
create policy "Owner progress is updatable by device"
on public.watch_progress for update
to anon, authenticated
using (
  owner_id = current_setting('request.headers', true)::json->>'x-owner-id'
  and device_id = current_setting('request.headers', true)::json->>'x-device-id'
)
with check (
  owner_id = current_setting('request.headers', true)::json->>'x-owner-id'
  and device_id = current_setting('request.headers', true)::json->>'x-device-id'
);

grant usage on schema public to anon, authenticated;
revoke all on public.courses from anon, authenticated;
revoke all on public.lessons from anon, authenticated;
revoke all on public.watch_progress from anon, authenticated;
revoke all on public.app_secrets from anon, authenticated;
