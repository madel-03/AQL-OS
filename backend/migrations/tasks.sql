create table if not exists public.personal_tasks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  notes text not null default '' check (length(notes) <= 4000),
  due_date date,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists personal_tasks_user_created on public.personal_tasks(user_id, created_at desc);
alter table public.personal_tasks enable row level security;
revoke all on public.personal_tasks from anon, authenticated;
grant all on public.personal_tasks to service_role;
