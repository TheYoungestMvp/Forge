-- Apply after 003_project_deletion.sql. Legacy requests retain a null task contract.
begin;

alter table public.messages add column if not exists task_contract jsonb;
do $$ begin
if not exists(select 1 from pg_constraint where conname='messages_task_contract_check' and conrelid='public.messages'::regclass) then
alter table public.messages add constraint messages_task_contract_check check (
  task_contract is null or coalesce(
    jsonb_typeof(task_contract)='object'
    and task_contract->'version'='"1"'::jsonb
    and octet_length(task_contract::text)<=65536,
    false
  )
);
end if;
end $$;

-- The application validates the full strict TaskSpec schema before claiming work.
-- Bind only to the fenced attempt; the existing begin RPC preserves this column on retry.
create or replace function public.forge_bind_task_contract(
  p_owner_id uuid,p_project_id uuid,p_request_id uuid,p_run_token uuid,p_task_contract jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user public.messages; v_message public.messages;
begin
  perform 1 from public.projects where id=p_project_id and owner_id=p_owner_id for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  select * into v_user from public.messages where project_id=p_project_id and request_id=p_request_id and role='user';
  select * into v_message from public.messages where project_id=p_project_id and request_id=p_request_id and role='assistant';
  if v_user.id is null or v_message.id is null then
    raise exception 'Request not found' using errcode='P0002';
  end if;
  if not coalesce(jsonb_typeof(p_task_contract)='object'
      and p_task_contract->'version'='"1"'::jsonb
      and octet_length(p_task_contract::text)<=65536,false) then
    raise exception 'Invalid task contract' using errcode='22023';
  end if;
  if (v_user.task_contract is not null and v_user.task_contract is distinct from p_task_contract)
      or (v_message.task_contract is not null and v_message.task_contract is distinct from p_task_contract) then
    raise exception 'Request ID conflict' using errcode='P0409';
  end if;
  if v_message.status is distinct from 'processing' or v_message.run_token is distinct from p_run_token
      or p_run_token is null or v_message.deadline_at is null or v_message.deadline_at<=clock_timestamp() then
    raise exception 'Request expired or superseded' using errcode='57014';
  end if;
  if v_user.task_contract is null then
    update public.messages set task_contract=p_task_contract where id=v_user.id;
  end if;
  -- Recheck before the next write: a trigger or lock wait may consume the remaining deadline.
  if clock_timestamp()>=v_message.deadline_at then
    raise exception 'Generation deadline expired' using errcode='57014';
  end if;
  if v_message.task_contract is null then
    update public.messages set task_contract=p_task_contract where id=v_message.id returning * into v_message;
  end if;
  -- Expiration during either write rolls back both message updates and their triggers.
  if clock_timestamp()>=v_message.deadline_at then
    raise exception 'Generation deadline expired' using errcode='57014';
  end if;
  return to_jsonb(v_message);
end;
$$;

revoke all on public.messages from public,anon,authenticated;
revoke all on function public.forge_bind_task_contract(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.forge_bind_task_contract(uuid,uuid,uuid,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
