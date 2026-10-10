-- Apply after 001_persistence.sql. No existing projects, messages or versions are deleted.
-- Legacy shared projects remain ownerless/private. They are never claimed by a visitor.
begin;

alter table public.projects add column if not exists owner_id uuid;
create index if not exists projects_owner_updated_idx on public.projects(owner_id, updated_at desc);
alter table public.messages add column if not exists status text check (status in ('processing','completed','failed'));
alter table public.messages add column if not exists phase integer not null default 0 check (phase between 0 and 4);
alter table public.messages add column if not exists plan jsonb not null default '[]'::jsonb;
alter table public.messages add column if not exists error_code text;
alter table public.messages add column if not exists base_version_id uuid;
alter table public.messages add column if not exists deadline_at timestamptz;
alter table public.messages add column if not exists run_token uuid;
alter table public.messages add column if not exists finished_at timestamptz;
alter table public.messages add column if not exists operation text not null default 'generate' check (operation in ('generate','restore'));
alter table public.messages add column if not exists source_version_id uuid;
alter table public.messages add column if not exists attempts integer not null default 0;
alter table public.messages add column if not exists attempted_at timestamptz;
create index if not exists messages_active_idx on public.messages(project_id, deadline_at) where status = 'processing';
create index if not exists messages_attempts_idx on public.messages(attempted_at) where role = 'assistant';

-- Recover legacy failures/unpaired requests without labelling them completed.
update public.messages m set
  status = case when exists(select 1 from public.versions v where v.id=m.request_id and v.project_id=m.project_id) then 'completed' else 'failed' end,
  phase = case when exists(select 1 from public.versions v where v.id=m.request_id and v.project_id=m.project_id) then 4 else 0 end,
  error_code = case when exists(select 1 from public.versions v where v.id=m.request_id and v.project_id=m.project_id) then null else 'GENERATION_INTERRUPTED' end,
  operation = case when m.content like 'v% is ready%' and exists(select 1 from public.versions v where v.id=m.request_id and v.prompt ~ '^Restore v[0-9]+$') then 'restore' else 'generate' end,
  finished_at = m.created_at
where m.role='assistant' and m.status is null;
update public.messages m set content=format('v%s of %s is ready. Try its controls in Preview, or describe what you would like to change next.',v.version_number,v.title)
from public.versions v where v.id=m.request_id and v.project_id=m.project_id and m.role='assistant' and m.status='completed';
insert into public.messages(project_id,request_id,role,content,status,error_code,base_version_id)
select u.project_id,u.request_id,'assistant','The previous request was interrupted. Retry to continue; saved versions are kept.','failed','GENERATION_INTERRUPTED',
  (select v.id from public.versions v where v.project_id=u.project_id and v.created_at<=u.created_at order by version_number desc limit 1)
from public.messages u where u.role='user'
and not exists(select 1 from public.messages a where a.project_id=u.project_id and a.request_id=u.request_id and a.role='assistant')
and not exists(select 1 from public.versions v where v.id=u.request_id and v.project_id=u.project_id);

create or replace function public.forge_saved_result(p_project_id uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select jsonb_build_object('project',to_jsonb(p),'version',to_jsonb(v),'message',to_jsonb(m))
  from public.projects p join public.versions v on v.project_id=p.id
  join public.messages m on m.project_id=p.id and m.request_id=v.id and m.role='assistant'
  where p.id=p_project_id and v.id=p_request_id and m.status='completed';
$$;

create or replace function public.forge_load_project(p_owner_id uuid,p_project_id uuid,p_status_only boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_project public.projects;
begin
  select * into v_project from public.projects where id=p_project_id and owner_id=p_owner_id for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  update public.messages set status='failed',error_code='GENERATION_TIMEOUT',finished_at=clock_timestamp(),run_token=null,
    content='The previous request timed out or was interrupted. Retry to continue; saved versions are kept.'
  where project_id=p_project_id and status='processing' and deadline_at<=clock_timestamp();
  select * into v_project from public.projects where id=p_project_id;
  return jsonb_build_object('project',to_jsonb(v_project),
    'messages',coalesce((select jsonb_agg(to_jsonb(m) order by seq) from public.messages m where project_id=p_project_id),'[]'::jsonb),
    'versions',case when p_status_only then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(v) order by version_number) from public.versions v where project_id=p_project_id),'[]'::jsonb) end);
end;
$$;

-- A database claim, not a process-local promise, is the model-call fence.
-- A fixed advisory lock makes owner/global quotas atomic across projects and servers.
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
  if coalesce((select sum(m.attempts) from public.messages m join public.projects p on p.id=m.project_id where p.owner_id=p_owner_id and m.attempted_at>clock_timestamp()-interval '1 hour'),0)>=10
    or coalesce((select sum(m.attempts) from public.messages m join public.projects p on p.id=m.project_id where p.owner_id=p_owner_id and m.attempted_at>clock_timestamp()-interval '1 day'),0)>=30
    or (p_operation='generate' and (coalesce((select sum(attempts) from public.messages where operation='generate' and attempted_at>clock_timestamp()-interval '1 hour'),0)>=30
    or coalesce((select sum(attempts) from public.messages where operation='generate' and attempted_at>clock_timestamp()-interval '1 day'),0)>=100)) then
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

create or replace function public.forge_advance_generation(p_owner_id uuid,p_project_id uuid,p_request_id uuid,p_run_token uuid,p_phase integer,p_content text,p_plan jsonb default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_message public.messages;
begin
  perform 1 from public.projects where id=p_project_id and owner_id=p_owner_id for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  update public.messages set phase=greatest(phase,p_phase),content=p_content,plan=coalesce(p_plan,plan)
  where project_id=p_project_id and request_id=p_request_id and role='assistant' and status='processing'
    and run_token=p_run_token and deadline_at>clock_timestamp()
  returning * into v_message;
  if not found then raise exception 'Request expired or superseded' using errcode='57014'; end if;
  return to_jsonb(v_message);
end;
$$;

create or replace function public.forge_finish_generation(p_owner_id uuid,p_project_id uuid,p_request_id uuid,p_run_token uuid,p_app jsonb,p_model text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_project public.projects; v_latest public.versions; v_message public.messages; v_user public.messages; v_version public.versions; v_saved jsonb;
begin
  select * into v_project from public.projects where id=p_project_id and owner_id=p_owner_id for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  v_saved:=public.forge_saved_result(p_project_id,p_request_id);
  if v_saved is not null then return v_saved; end if;
  select * into v_message from public.messages where project_id=p_project_id and request_id=p_request_id and role='assistant';
  if v_message.status is distinct from 'processing' or v_message.run_token is distinct from p_run_token then
    raise exception 'Request expired or superseded' using errcode='57014';
  end if;
  if v_message.deadline_at<=clock_timestamp() then raise exception 'Generation deadline expired' using errcode='57014'; end if;
  select * into v_latest from public.versions where project_id=p_project_id order by version_number desc limit 1;
  if v_latest.id is distinct from v_message.base_version_id then raise exception 'Project changed' using errcode='40001'; end if;
  select * into v_user from public.messages where project_id=p_project_id and request_id=p_request_id and role='user';
  insert into public.versions(id,project_id,prompt,title,html,css,javascript,version_number,parent_id,model)
  values(p_request_id,p_project_id,v_user.content,p_app->>'title',p_app->>'html',p_app->>'css',p_app->>'javascript',coalesce(v_latest.version_number,0)+1,v_latest.id,p_model)
  returning * into v_version;
  update public.messages set status='completed',phase=4,error_code=null,finished_at=clock_timestamp(),run_token=null,
    content=format('v%s of %s is ready. Try its controls in Preview, or describe what you would like to change next.',v_version.version_number,v_version.title)
  where id=v_message.id returning * into v_message;
  update public.projects set name=case when name='Untitled project' and v_version.version_number=1 then v_version.title else name end,updated_at=clock_timestamp()
  where id=p_project_id returning * into v_project;
  -- Recheck after writes/triggers; expiration rolls back the entire transaction.
  if v_message.finished_at>=v_message.deadline_at or clock_timestamp()>=v_message.deadline_at then
    raise exception 'Generation deadline expired' using errcode='57014';
  end if;
  return jsonb_build_object('project',to_jsonb(v_project),'version',to_jsonb(v_version),'message',to_jsonb(v_message));
end;
$$;

-- Failure is conditional on this attempt's fence, and can never overwrite success.
-- This also reconciles a committed save whose HTTP response was lost.
create or replace function public.forge_fail_generation(p_owner_id uuid,p_project_id uuid,p_request_id uuid,p_run_token uuid,p_code text,p_message text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_saved jsonb; v_message public.messages;
begin
  perform 1 from public.projects where id=p_project_id and owner_id=p_owner_id for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  v_saved:=public.forge_saved_result(p_project_id,p_request_id);
  if v_saved is not null then return jsonb_build_object('state','completed','saved',v_saved); end if;
  update public.messages set status='failed',error_code=p_code,content=p_message,finished_at=clock_timestamp(),run_token=null
  where project_id=p_project_id and request_id=p_request_id and role='assistant' and status='processing' and run_token=p_run_token
  returning * into v_message;
  if not found then
    select * into v_message from public.messages where project_id=p_project_id and request_id=p_request_id and role='assistant';
  end if;
  return jsonb_build_object('state',coalesce(v_message.status,'failed'),'message',to_jsonb(v_message));
end;
$$;

-- Replace the legacy unfenced write path. Only server-held credentials can call the new RPCs.
revoke execute on function public.forge_save_generation(uuid,uuid,text,uuid,jsonb,text) from service_role;
revoke all on function public.forge_saved_result(uuid,uuid), public.forge_load_project(uuid,uuid,boolean),
  public.forge_begin_generation(uuid,uuid,uuid,text,uuid,uuid,timestamptz,text,uuid),
  public.forge_advance_generation(uuid,uuid,uuid,uuid,integer,text,jsonb),
  public.forge_finish_generation(uuid,uuid,uuid,uuid,jsonb,text), public.forge_fail_generation(uuid,uuid,uuid,uuid,text,text)
from public,anon,authenticated;
grant execute on function public.forge_saved_result(uuid,uuid), public.forge_load_project(uuid,uuid,boolean),
  public.forge_begin_generation(uuid,uuid,uuid,text,uuid,uuid,timestamptz,text,uuid),
  public.forge_advance_generation(uuid,uuid,uuid,uuid,integer,text,jsonb),
  public.forge_finish_generation(uuid,uuid,uuid,uuid,jsonb,text), public.forge_fail_generation(uuid,uuid,uuid,uuid,text,text)
to service_role;
commit;
