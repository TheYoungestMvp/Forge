-- Apply after 002_demo_hardening.sql. Installing this function deletes no data.
begin;

-- Keep only minimal, recent usage totals when the associated source/chat is deleted.
-- Deleting and recreating projects must not reset the paid-call budgets.
create table if not exists public.deleted_project_attempts (
  owner_id uuid not null,
  operation text not null check (operation in ('generate','restore')),
  attempts integer not null check (attempts > 0),
  attempted_at timestamptz not null
);
create index if not exists deleted_project_attempts_time_idx on public.deleted_project_attempts(attempted_at);
alter table public.deleted_project_attempts enable row level security;
revoke all on public.deleted_project_attempts from public,anon,authenticated;
grant select,insert,delete on public.deleted_project_attempts to service_role;

create or replace view public.forge_operation_attempts with (security_invoker=true) as
  select p.owner_id,m.operation,m.attempts,m.attempted_at
  from public.messages m join public.projects p on p.id=m.project_id
  where m.role='assistant' and m.attempts>0
  union all
  select owner_id,operation,attempts,attempted_at from public.deleted_project_attempts;
revoke all on public.forge_operation_attempts from public,anon,authenticated;
grant select on public.forge_operation_attempts to service_role;

create or replace function public.forge_delete_project(p_owner_id uuid, p_project_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(197608,1);
  -- Share the project lock with generation/restore so checking and deleting are atomic.
  perform 1 from public.projects where id=p_project_id and owner_id=p_owner_id for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if exists (
    select 1 from public.messages where project_id=p_project_id and role='assistant'
      and status='processing' and deadline_at>clock_timestamp()
  ) then
    raise exception 'Project has an active request' using errcode='55P03';
  end if;
  delete from public.deleted_project_attempts where attempted_at<=clock_timestamp()-interval '1 day';
  insert into public.deleted_project_attempts(owner_id,operation,attempts,attempted_at)
  select p_owner_id,operation,attempts,attempted_at from public.messages
  where project_id=p_project_id and role='assistant' and attempts>0
    and attempted_at>clock_timestamp()-interval '1 day';
  -- The existing foreign keys also remove the project's chat and source versions.
  delete from public.projects where id=p_project_id and owner_id=p_owner_id;
end;
$$;

revoke all on function public.forge_delete_project(uuid,uuid) from public,anon,authenticated;
grant execute on function public.forge_delete_project(uuid,uuid) to service_role;
-- Preserve the existing workflow; quotas now include deleted-project usage.
create or replace function public.forge_begin_generation(
  p_owner_id uuid,p_project_id uuid,p_request_id uuid,p_prompt text,p_base_version_id uuid,
  p_run_token uuid,p_deadline_at timestamptz,p_operation text default 'generate',p_source_version_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_project public.projects; v_latest public.versions; v_user public.messages; v_message public.messages; v_saved jsonb;
begin
  perform pg_advisory_xact_lock(197608,1);
  select * into v_project from public.projects where id=p_project_id and owner_id=p_owner_id for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if p_operation not in ('generate','restore') or char_length(btrim(p_prompt)) not between 1 and 4000 or p_run_token is null then
    raise exception 'Invalid request' using errcode='22023';
  end if;
  select * into v_user from public.messages where project_id=p_project_id and request_id=p_request_id and role='user';
  select * into v_message from public.messages where project_id=p_project_id and request_id=p_request_id and role='assistant';
  if v_user.id is not null and (v_user.content<>p_prompt or (v_message.id is not null and (v_message.operation is distinct from p_operation or v_message.source_version_id is distinct from p_source_version_id))) then
    raise exception 'Request ID conflict' using errcode='22023';
  end if;
  v_saved:=public.forge_saved_result(p_project_id,p_request_id);
  if v_saved is not null then return jsonb_build_object('state','completed','saved',v_saved,'userMessage',to_jsonb(v_user)); end if;
  if v_message.status='processing' and v_message.deadline_at>clock_timestamp() then
    return jsonb_build_object('state','processing','message',to_jsonb(v_message),'userMessage',to_jsonb(v_user));
  end if;
  update public.messages set status='failed',error_code='GENERATION_TIMEOUT',finished_at=clock_timestamp(),run_token=null,
    content='The previous request timed out or was interrupted. Retry to continue; saved versions are kept.'
  where status='processing' and deadline_at<=clock_timestamp() and project_id in(select id from public.projects where owner_id=p_owner_id);
  if exists(select 1 from public.messages m join public.projects p on p.id=m.project_id where p.owner_id=p_owner_id and m.status='processing') then
    raise exception 'Another request is active' using errcode='55P03';
  end if;
  if p_deadline_at<=clock_timestamp() or p_deadline_at>clock_timestamp()+interval '125 seconds' then
    raise exception 'Generation deadline expired' using errcode='57014';
  end if;
  select * into v_latest from public.versions where project_id=p_project_id order by version_number desc limit 1;
  if v_latest.id is distinct from p_base_version_id then raise exception 'Project changed' using errcode='40001'; end if;
  if p_operation='restore' and not exists(select 1 from public.versions where id=p_source_version_id and project_id=p_project_id) then
    raise exception 'Version not found' using errcode='P0002';
  end if;
  -- Retried failed requests count again. Anonymous-session rotation cannot bypass the global ceiling.
  if coalesce((select sum(m.attempts) from public.forge_operation_attempts m where m.owner_id=p_owner_id and m.attempted_at>clock_timestamp()-interval '1 hour'),0)>=10
    or coalesce((select sum(m.attempts) from public.forge_operation_attempts m where m.owner_id=p_owner_id and m.attempted_at>clock_timestamp()-interval '1 day'),0)>=30
    or (p_operation='generate' and (coalesce((select sum(attempts) from public.forge_operation_attempts where operation='generate' and attempted_at>clock_timestamp()-interval '1 hour'),0)>=30
    or coalesce((select sum(attempts) from public.forge_operation_attempts where operation='generate' and attempted_at>clock_timestamp()-interval '1 day'),0)>=100)) then
    raise exception 'Demo quota reached' using errcode='P0429';
  end if;
  if v_user.id is null then
    insert into public.messages(id,project_id,request_id,role,content) values(p_request_id,p_project_id,p_request_id,'user',p_prompt) returning * into v_user;
  end if;
  insert into public.messages(project_id,request_id,role,content,status,phase,plan,base_version_id,deadline_at,run_token,operation,source_version_id,attempts,attempted_at)
  values(p_project_id,p_request_id,'assistant','Understanding requirements','processing',0,'[]'::jsonb,p_base_version_id,p_deadline_at,p_run_token,p_operation,p_source_version_id,1,clock_timestamp())
  on conflict(project_id,request_id,role) do update set content=excluded.content,status='processing',phase=0,plan='[]'::jsonb,error_code=null,
    base_version_id=excluded.base_version_id,deadline_at=excluded.deadline_at,run_token=excluded.run_token,finished_at=null,
    attempts=public.messages.attempts+1,attempted_at=excluded.attempted_at
  returning * into v_message;
  return jsonb_build_object('state','claimed','project',to_jsonb(v_project),'currentVersion',case when v_latest.id is null then null else to_jsonb(v_latest) end,
    'userMessage',to_jsonb(v_user),'message',to_jsonb(v_message));
end;
$$;

notify pgrst, 'reload schema';
commit;
