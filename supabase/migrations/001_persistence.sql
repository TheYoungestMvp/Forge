-- Run once in the SQL Editor of a dedicated Forge demo Supabase project.
-- No tables are dropped. Service credentials are used only by Next.js routes.
begin;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default clock_timestamp(),
  request_id uuid not null,
  seq bigint generated always as identity unique,
  unique (project_id, request_id, role)
);

create table if not exists public.versions (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  prompt text not null check (char_length(btrim(prompt)) between 1 and 4000),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  html text not null check (octet_length(html) between 1 and 65536),
  css text not null check (octet_length(css) <= 65536),
  javascript text not null check (octet_length(javascript) between 1 and 65536),
  created_at timestamptz not null default clock_timestamp(),
  version_number integer not null check (version_number > 0),
  parent_id uuid references public.versions(id),
  model text not null check (char_length(model) <= 200),
  unique (project_id, version_number),
  check (octet_length(title) + octet_length(html) + octet_length(css) + octet_length(javascript) <= 131072)
);

create index if not exists messages_project_seq_idx on public.messages(project_id, seq);
create index if not exists projects_updated_at_idx on public.projects(updated_at desc);

create or replace function public.forge_touch_project() returns trigger
language plpgsql set search_path = public as $$
begin
  update public.projects set updated_at = clock_timestamp() where id = new.project_id;
  return new;
end;
$$;
drop trigger if exists forge_message_touch on public.messages;
create trigger forge_message_touch after insert or update on public.messages
for each row execute function public.forge_touch_project();

-- Version, assistant response and project metadata commit in one transaction.
-- A reused request ID returns the committed result without creating duplicates.
create or replace function public.forge_save_generation(
  p_project_id uuid,
  p_request_id uuid,
  p_prompt text,
  p_base_version_id uuid,
  p_app jsonb,
  p_model text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_project public.projects;
  v_latest public.versions;
  v_version public.versions;
  v_message public.messages;
begin
  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  select * into v_version from public.versions where id = p_request_id and project_id = p_project_id;
  if not found then
    select * into v_latest from public.versions where project_id = p_project_id order by version_number desc limit 1;
    if v_latest.id is distinct from p_base_version_id then
      raise exception 'Project has a newer version' using errcode = '40001';
    end if;
    insert into public.versions (id, project_id, prompt, title, html, css, javascript, version_number, parent_id, model)
    values (p_request_id, p_project_id, p_prompt, p_app->>'title', p_app->>'html', p_app->>'css', p_app->>'javascript', coalesce(v_latest.version_number,0)+1, v_latest.id, p_model)
    returning * into v_version;
    insert into public.messages (project_id, request_id, role, content)
    values (p_project_id, p_request_id, 'assistant', format('v%s of %s is ready. Try its controls in Preview, or describe what you would like to change next.', v_version.version_number, v_version.title))
    on conflict (project_id, request_id, role) do update set content = excluded.content
    returning * into v_message;
    update public.projects set
      name = case when name = 'Untitled project' and v_version.version_number = 1 then v_version.title else name end,
      updated_at = clock_timestamp()
    where id = p_project_id returning * into v_project;
  else
    select * into v_message from public.messages where project_id = p_project_id and request_id = p_request_id and role = 'assistant';
  end if;
  return jsonb_build_object('project', to_jsonb(v_project), 'version', to_jsonb(v_version), 'message', to_jsonb(v_message));
end;
$$;

alter table public.projects enable row level security;
alter table public.messages enable row level security;
alter table public.versions enable row level security;
revoke all on public.projects, public.messages, public.versions from anon, authenticated;
grant select, insert, update, delete on public.projects, public.messages, public.versions to service_role;
grant usage, select on sequence public.messages_seq_seq to service_role;
revoke all on function public.forge_save_generation(uuid,uuid,text,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.forge_save_generation(uuid,uuid,text,uuid,jsonb,text) to service_role;
revoke all on function public.forge_touch_project() from public, anon, authenticated;
grant execute on function public.forge_touch_project() to service_role;
commit;
