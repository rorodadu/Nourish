-- Nourish phase 2: public menus, diner orders, table occupancy.
-- Run this once in Supabase > SQL Editor (after the phase 1 SQL).

-- 1) Public menu: anyone can read, only the owner can write.
create table public.public_menus (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  slug text not null unique,
  name text not null,
  cuisine text, city text,
  dish_count int not null default 0,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table public.public_menus enable row level security;
create policy "anyone reads menus" on public.public_menus for select using (true);
create policy "owner inserts menu" on public.public_menus for insert with check (auth.uid() = account_id);
create policy "owner updates menu" on public.public_menus for update using (auth.uid() = account_id) with check (auth.uid() = account_id);
create policy "owner deletes menu" on public.public_menus for delete using (auth.uid() = account_id);

-- 2) Orders: only the restaurant owner can read/change them. Diners use the functions below.
create table public.orders (
  id bigint generated always as identity primary key,
  rid uuid not null references public.accounts(id) on delete cascade,
  token text not null,
  status text not null default 'pending',
  data jsonb not null default '{}',
  done boolean not null default false,
  rating int,
  comment text,
  created_at timestamptz default now(),
  finished_at timestamptz
);
create index orders_rid_idx on public.orders (rid, created_at desc);
alter table public.orders enable row level security;
create policy "owner orders" on public.orders for all using (auth.uid() = rid) with check (auth.uid() = rid);

-- 3) Which tables are taken.
create table public.occupancy (
  rid uuid not null references public.accounts(id) on delete cascade,
  table_no text not null,
  token text not null,
  taken_at timestamptz default now(),
  primary key (rid, table_no)
);
alter table public.occupancy enable row level security;
create policy "owner occupancy" on public.occupancy for all using (auth.uid() = rid) with check (auth.uid() = rid);

-- 4) Functions diners (not logged in) can call.
create function public.place_order(p_rid uuid, p_token text, p_data jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare t text := p_data->>'table'; new_id bigint; cur text;
begin
  if not exists (select 1 from public_menus where account_id = p_rid) then raise exception 'no_restaurant'; end if;
  if length(p_token) < 8 or length(p_token) > 64 then raise exception 'bad_token'; end if;
  if pg_column_size(p_data) > 60000 then raise exception 'too_big'; end if;
  if coalesce(t, '') <> '' then
    select token into cur from occupancy where rid = p_rid and table_no = t for update;
    if cur is not null and cur <> p_token then raise exception 'table_taken'; end if;
    insert into occupancy (rid, table_no, token) values (p_rid, t, p_token)
      on conflict (rid, table_no) do update set token = excluded.token, taken_at = now();
  end if;
  insert into orders (rid, token, data) values (p_rid, p_token, p_data - 'id' - 'rid' - 'status') returning id into new_id;
  return new_id;
end $$;

create function public.get_order(p_id bigint, p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select o.data || jsonb_build_object('id', o.id, 'rid', o.rid, 'status', o.status, 'done', o.done, 'rating', o.rating, 'comment', o.comment)
  from orders o where o.id = p_id and o.token = p_token;
$$;

create function public.finish_order(p_id bigint, p_token text, p_rating int, p_comment text) returns void
language sql security definer set search_path = public as $$
  update orders set done = true, finished_at = now(),
    rating = case when p_rating between 1 and 5 then p_rating end,
    comment = left(coalesce(p_comment, ''), 300)
  where id = p_id and token = p_token;
$$;

create function public.get_occupancy(p_rid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(table_no, token), '{}'::jsonb) from occupancy where rid = p_rid;
$$;

grant execute on function public.place_order(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.get_order(bigint, text) to anon, authenticated;
grant execute on function public.finish_order(bigint, text, int, text) to anon, authenticated;
grant execute on function public.get_occupancy(uuid) to anon, authenticated;
