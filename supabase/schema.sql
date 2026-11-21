create extension if not exists pgcrypto;

drop function if exists public.get_my_bookings(uuid[]);
drop function if exists public.cancel_my_booking(uuid, uuid);
drop function if exists public.book_bus(uuid, text, integer, text);

create table if not exists public.companies (
    id uuid primary key references auth.users (id) on delete cascade,
    name text not null check (char_length(trim(name)) between 2 and 80),
    logo_data text not null default '',
    created_at timestamptz not null default now()
);

create table if not exists public.buses (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies (id) on delete cascade,
    name text not null check (char_length(trim(name)) between 1 and 60),
    from_city text not null check (char_length(trim(from_city)) between 1 and 60),
    to_city text not null check (char_length(trim(to_city)) between 1 and 60),
    travel_date date not null,
    departure_time time not null,
    total_seats integer not null check (total_seats between 1 and 100),
    available_seats integer not null check (available_seats between 0 and total_seats),
    fare numeric(12, 2) not null check (fare >= 0),
    route_distance_km numeric(8, 2) check (route_distance_km between 0.1 and 1000),
    estimated_duration_minutes integer check (estimated_duration_minutes between 1 and 1440),
    intermediate_stops text not null default '' check (char_length(intermediate_stops) <= 300),
    fare_category text not null default 'intercity' check (fare_category in ('kigali', 'intercity')),
    is_active boolean not null default true,
    is_cancelled boolean not null default false,
    created_at timestamptz not null default now(),
    check (lower(trim(from_city)) <> lower(trim(to_city)))
);

alter table public.buses
    add column if not exists route_distance_km numeric(8, 2);
alter table public.buses
    add column if not exists estimated_duration_minutes integer
    check (estimated_duration_minutes between 1 and 1440);
alter table public.buses
    add column if not exists intermediate_stops text not null default ''
    check (char_length(intermediate_stops) <= 300);
alter table public.buses
    add column if not exists fare_category text not null default 'intercity';
alter table public.buses
    add column if not exists is_active boolean not null default true;
alter table public.buses
    add column if not exists is_cancelled boolean not null default false;

create table if not exists public.bookings (
    id uuid primary key default gen_random_uuid(),
    bus_id uuid not null references public.buses (id) on delete restrict,
    bus_name text not null,
    from_city text not null,
    to_city text not null,
    travel_date date not null,
    departure_time time not null,
    estimated_duration_minutes integer check (estimated_duration_minutes between 1 and 1440),
    intermediate_stops text not null default '' check (char_length(intermediate_stops) <= 300),
    passenger_name text not null check (char_length(trim(passenger_name)) between 1 and 80),
    passenger_phone text,
    seat_count integer not null check (seat_count between 1 and 20),
    base_fare numeric(12, 2) not null check (base_fare >= 0),
    platform_fee numeric(12, 2) not null check (platform_fee >= 0),
    total_fare numeric(12, 2) not null check (total_fare = base_fare + platform_fee),
    payment_method text not null check (payment_method in ('MTN Mobile Money', 'Airtel Money')),
    payment_status text not null default 'demo-unpaid' check (payment_status = 'demo-unpaid'),
    cancelled boolean not null default false,
    ussd_session_id text,
    created_at timestamptz not null default now()
);

alter table public.bookings
    add column if not exists passenger_phone text;
alter table public.bookings
    add column if not exists ussd_session_id text;
alter table public.bookings
    add column if not exists bus_name text;
alter table public.bookings
    add column if not exists from_city text;
alter table public.bookings
    add column if not exists to_city text;
alter table public.bookings
    add column if not exists travel_date date;
alter table public.bookings
    add column if not exists departure_time time;
alter table public.bookings
    add column if not exists estimated_duration_minutes integer;
alter table public.bookings
    add column if not exists intermediate_stops text;
update public.bookings
   set bus_name = buses.name,
       from_city = buses.from_city,
       to_city = buses.to_city,
       travel_date = buses.travel_date,
       departure_time = buses.departure_time,
       estimated_duration_minutes = buses.estimated_duration_minutes,
       intermediate_stops = buses.intermediate_stops
  from public.buses
 where buses.id = bookings.bus_id
   and (bookings.bus_name is null
        or bookings.from_city is null
        or bookings.to_city is null
        or bookings.travel_date is null
        or bookings.departure_time is null
        or bookings.intermediate_stops is null);
alter table public.bookings
    alter column bus_name set not null,
    alter column from_city set not null,
    alter column to_city set not null,
    alter column travel_date set not null,
    alter column departure_time set not null,
    alter column intermediate_stops set default '',
    alter column intermediate_stops set not null;
alter table public.bookings
    drop constraint if exists bookings_estimated_duration_minutes_check;
alter table public.bookings
    add constraint bookings_estimated_duration_minutes_check
    check (estimated_duration_minutes between 1 and 1440);
alter table public.bookings
    drop constraint if exists bookings_intermediate_stops_check;
alter table public.bookings
    add constraint bookings_intermediate_stops_check
    check (char_length(intermediate_stops) <= 300);
drop index if exists public.bookings_cancel_token_idx;
alter table public.bookings
    drop column if exists cancel_token;
update public.bookings
   set passenger_phone = case
       when passenger_phone ~ '^0[0-9]{9}$' then '+250' || substring(passenger_phone from 2)
       when passenger_phone ~ '^250[0-9]{9}$' then '+' || passenger_phone
       when passenger_phone ~ '^\+2507[0-9]{8}$' then passenger_phone
       else null
   end
 where passenger_phone is not null;
alter table public.bookings
    drop constraint if exists bookings_passenger_phone_format_check;
alter table public.bookings
    add constraint bookings_passenger_phone_format_check
    check (passenger_phone is null or passenger_phone ~ '^\+2507[0-9]{8}$');

create index if not exists buses_search_idx
    on public.buses (travel_date, from_city, to_city, company_id);
create index if not exists bookings_bus_id_idx on public.bookings (bus_id);
create index if not exists bookings_passenger_phone_idx on public.bookings (passenger_phone);
create unique index if not exists bookings_ussd_session_id_idx
    on public.bookings (ussd_session_id)
    where ussd_session_id is not null;

create table if not exists public.ussd_sessions (
    session_id text primary key check (session_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
    phone text,
    state jsonb not null,
    input_cursor smallint not null default 0 check (input_cursor between 0 and 12),
    expires_at timestamptz not null,
    updated_at timestamptz not null default now()
);
create index if not exists ussd_sessions_expires_at_idx
    on public.ussd_sessions (expires_at);

create or replace function public.set_rura_bus_fare()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    rate_per_km numeric(5, 2);
begin
    if new.route_distance_km is null or new.route_distance_km not between 0.1 and 1000 then
        raise exception 'Enter a route distance from 0.1 to 1,000 km.';
    end if;

    if new.fare_category = 'kigali' then
        rate_per_km := 59.28;
    elsif new.fare_category = 'intercity' then
        rate_per_km := 41.58;
    else
        raise exception 'Choose a valid RURA fare area.';
    end if;

    new.fare := round(new.route_distance_km * rate_per_km);
    if tg_op = 'INSERT' then
        new.available_seats := new.total_seats;
    end if;
    return new;
end;
$$;

drop trigger if exists set_rura_bus_fare_before_save on public.buses;
create trigger set_rura_bus_fare_before_save
    before insert or update of route_distance_km, fare_category
    on public.buses
    for each row execute function public.set_rura_bus_fare();
revoke execute on function public.set_rura_bus_fare() from public, anon, authenticated;

create or replace function public.preserve_reserved_bus_seats()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.total_seats < old.total_seats - old.available_seats then
        raise exception 'Total seats cannot be lower than seats already reserved.';
    end if;

    new.available_seats := new.available_seats + (new.total_seats - old.total_seats);
    return new;
end;
$$;

drop trigger if exists preserve_reserved_bus_seats_before_update on public.buses;
create trigger preserve_reserved_bus_seats_before_update
    before update of total_seats
    on public.buses
    for each row execute function public.preserve_reserved_bus_seats();
revoke execute on function public.preserve_reserved_bus_seats() from public, anon, authenticated;

drop trigger if exists protect_booked_bus_details_before_update on public.buses;
drop function if exists public.protect_booked_bus_details();

do $$
begin
    if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1
             from pg_catalog.pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'buses'
       ) then
        alter publication supabase_realtime add table public.buses;
    end if;
end;
$$;

alter table public.companies enable row level security;
alter table public.buses enable row level security;
alter table public.bookings enable row level security;
alter table public.ussd_sessions enable row level security;
revoke all on public.ussd_sessions from public, anon, authenticated;
grant all on public.ussd_sessions to service_role;

drop policy if exists "Public can view company profiles" on public.companies;
create policy "Public can view company profiles"
    on public.companies for select
    to anon, authenticated
    using (true);

drop policy if exists "Companies can update their own profile" on public.companies;
create policy "Companies can update their own profile"
    on public.companies for update
    to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

drop policy if exists "Public can view future bus schedules" on public.buses;
create policy "Public can view future bus schedules"
    on public.buses for select
    to anon, authenticated
    using (
        company_id = (select auth.uid())
        or (
            travel_date + departure_time > (now() at time zone 'Africa/Kigali')
            and is_active
            and not is_cancelled
            and available_seats > 0
        )
    );

drop policy if exists "Companies can add their own schedules" on public.buses;
create policy "Companies can add their own schedules"
    on public.buses for insert
    to authenticated
    with check (company_id = (select auth.uid()));

drop policy if exists "Companies can update their own schedules" on public.buses;
create policy "Companies can update their own schedules"
    on public.buses for update
    to authenticated
    using (company_id = (select auth.uid()))
    with check (company_id = (select auth.uid()));

drop policy if exists "Companies can remove their own schedules" on public.buses;
create policy "Companies can remove their own schedules"
    on public.buses for delete
    to authenticated
    using (company_id = (select auth.uid()));

grant usage on schema public to anon, authenticated, service_role;
grant select on public.companies, public.buses to anon, authenticated;
revoke insert, delete on public.buses from anon, authenticated;
grant insert (company_id, name, from_city, to_city, travel_date, departure_time, total_seats, route_distance_km, estimated_duration_minutes, intermediate_stops, fare_category)
    on public.buses to authenticated;
revoke update (fare) on public.buses from anon, authenticated;
grant update (name, from_city, to_city, travel_date, departure_time, total_seats, route_distance_km, estimated_duration_minutes, intermediate_stops, fare_category)
    on public.buses to authenticated;
grant update (is_active) on public.buses to authenticated;
grant delete on public.buses to authenticated;
grant update (name, logo_data) on public.companies to authenticated;
revoke all on public.bookings from anon, authenticated;

create or replace function public.create_company_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if char_length(trim(coalesce(new.raw_user_meta_data ->> 'company_name', ''))) between 2 and 80 then
        insert into public.companies (id, name)
        values (new.id, trim(new.raw_user_meta_data ->> 'company_name'));
    end if;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_company on auth.users;
create trigger on_auth_user_created_company
    after insert on auth.users
    for each row execute function public.create_company_profile();
revoke execute on function public.create_company_profile() from public, anon, authenticated;

create or replace function public.book_bus(
    p_bus_id uuid,
    p_passenger_name text,
    p_passenger_phone text,
    p_seat_count integer,
    p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_bus public.buses%rowtype;
    new_booking public.bookings%rowtype;
    clean_name text := trim(coalesce(p_passenger_name, ''));
    clean_phone text := regexp_replace(trim(coalesce(p_passenger_phone, '')), '[^0-9+]', '', 'g');
    base_amount numeric(12, 2);
    fee_amount numeric(12, 2);
begin
    if clean_phone ~ '^0[0-9]{9}$' then
        clean_phone := '+250' || substring(clean_phone from 2);
    elsif clean_phone ~ '^250[0-9]{9}$' then
        clean_phone := '+' || clean_phone;
    end if;
    if char_length(clean_name) not between 1 and 80 then
        raise exception 'Enter a passenger name of 1 to 80 characters.';
    end if;
    if clean_phone !~ '^\+2507[0-9]{8}$' then
        raise exception 'Enter a valid Rwanda mobile phone number.';
    end if;
    if p_seat_count is null or p_seat_count not between 1 and 20 then
        raise exception 'Choose between 1 and 20 passengers.';
    end if;
    if p_payment_method is null or p_payment_method not in ('MTN Mobile Money', 'Airtel Money') then
        raise exception 'Choose a supported payment method.';
    end if;

    select *
      into selected_bus
      from public.buses
     where id = p_bus_id
       and travel_date + departure_time > (now() at time zone 'Africa/Kigali')
        and is_active
          and not is_cancelled
      for update;

    if not found or selected_bus.available_seats < p_seat_count then
        raise exception 'This trip has departed or no longer has enough seats. Search again.';
    end if;

    base_amount := selected_bus.fare * p_seat_count;
    fee_amount := 0;

    update public.buses
       set available_seats = available_seats - p_seat_count
     where id = selected_bus.id;

    insert into public.bookings (
        bus_id, bus_name, from_city, to_city, travel_date, departure_time,
        estimated_duration_minutes, intermediate_stops,
        passenger_name, passenger_phone, seat_count, base_fare, platform_fee,
        total_fare, payment_method
    )
    values (
        selected_bus.id, selected_bus.name, selected_bus.from_city, selected_bus.to_city,
        selected_bus.travel_date, selected_bus.departure_time,
        selected_bus.estimated_duration_minutes, selected_bus.intermediate_stops,
        clean_name, clean_phone, p_seat_count, base_amount, fee_amount,
        base_amount + fee_amount, p_payment_method
    )
    returning * into new_booking;

    return jsonb_build_object(
        'id', new_booking.id,
        'bus_id', new_booking.bus_id,
        'passenger_name', new_booking.passenger_name,
        'passenger_phone', new_booking.passenger_phone,
        'company_id', selected_bus.company_id,
        'bus_name', new_booking.bus_name,
        'from_city', new_booking.from_city,
        'to_city', new_booking.to_city,
        'travel_date', new_booking.travel_date,
        'departure_time', new_booking.departure_time,
        'estimated_duration_minutes', new_booking.estimated_duration_minutes,
        'intermediate_stops', new_booking.intermediate_stops,
        'seat_count', new_booking.seat_count,
        'base_fare', new_booking.base_fare,
        'platform_fee', new_booking.platform_fee,
        'total_fare', new_booking.total_fare,
        'payment_method', new_booking.payment_method,
        'payment_status', new_booking.payment_status,
        'cancelled', new_booking.cancelled
    );
end;
$$;

create or replace function public.get_my_booking_by_reference(p_reference text)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    clean_reference text := upper(trim(coalesce(p_reference, '')));
    verified_phone text := auth.jwt() ->> 'phone';
begin
    if auth.uid() is null or verified_phone is null then
        raise exception 'Verify your booking phone number to continue.';
    end if;
    if clean_reference !~ '^[0-9A-F]{8,32}$' then
        raise exception 'Enter a valid booking reference.';
    end if;

    return query
    select jsonb_build_object(
        'id', bookings.id,
        'passenger_name', bookings.passenger_name,
        'bus_name', bookings.bus_name,
        'company_name', companies.name,
        'from_city', bookings.from_city,
        'to_city', bookings.to_city,
        'travel_date', bookings.travel_date,
        'departure_time', bookings.departure_time,
        'estimated_duration_minutes', bookings.estimated_duration_minutes,
        'intermediate_stops', bookings.intermediate_stops,
        'seat_count', bookings.seat_count,
        'base_fare', bookings.base_fare,
        'platform_fee', bookings.platform_fee,
        'total_fare', bookings.total_fare,
        'payment_method', bookings.payment_method,
        'payment_status', bookings.payment_status,
        'cancelled', bookings.cancelled
    )
      from public.bookings
      join public.buses on buses.id = bookings.bus_id
      join public.companies on companies.id = buses.company_id
     where bookings.passenger_phone = verified_phone
       and upper(left(replace(bookings.id::text, '-', ''), char_length(clean_reference))) = clean_reference
     order by bookings.created_at desc
     limit 10;
end;
$$;

create or replace function public.get_company_bookings()
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'id', bookings.id,
        'bus_id', bookings.bus_id,
        'passenger_name', bookings.passenger_name,
        'passenger_phone', bookings.passenger_phone,
        'company_id', buses.company_id,
        'company_name', companies.name,
        'company_logo', companies.logo_data,
        'bus_name', bookings.bus_name,
        'from_city', bookings.from_city,
        'to_city', bookings.to_city,
        'travel_date', bookings.travel_date,
        'departure_time', bookings.departure_time,
        'estimated_duration_minutes', bookings.estimated_duration_minutes,
        'intermediate_stops', bookings.intermediate_stops,
        'seat_count', bookings.seat_count,
        'base_fare', bookings.base_fare,
        'platform_fee', bookings.platform_fee,
        'total_fare', bookings.total_fare,
        'payment_method', bookings.payment_method,
        'payment_status', bookings.payment_status,
        'cancelled', bookings.cancelled
    )
    from public.bookings
    join public.buses on buses.id = bookings.bus_id
    join public.companies on companies.id = buses.company_id
    where buses.company_id = (select auth.uid())
    order by bookings.created_at desc;
$$;

create or replace function public.cancel_bus_trip(p_bus_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_bus public.buses%rowtype;
    released_seats integer;
begin
    if auth.uid() is null then
        raise exception 'Sign in with the bus company account to cancel this trip.';
    end if;

    select *
      into selected_bus
      from public.buses
     where id = p_bus_id
       and company_id = auth.uid()
     for update;
    if not found then
        raise exception 'The schedule was not found or you do not have permission to cancel it.';
    end if;
    if selected_bus.is_cancelled then
        return 0;
    end if;
    if selected_bus.travel_date + selected_bus.departure_time <=
        (now() at time zone 'Africa/Kigali') then
        raise exception 'A trip cannot be cancelled after its departure time.';
    end if;

    with cancelled_bookings as (
        update public.bookings
           set cancelled = true
         where bus_id = selected_bus.id
           and not cancelled
        returning seat_count
    )
    select coalesce(sum(seat_count), 0)::integer
      into released_seats
      from cancelled_bookings;

    update public.buses
       set is_cancelled = true,
           is_active = false,
           available_seats = least(total_seats, available_seats + released_seats)
     where id = selected_bus.id;

    return released_seats;
end;
$$;

revoke execute on function public.cancel_bus_trip(uuid) from public, anon, authenticated;
grant execute on function public.cancel_bus_trip(uuid) to authenticated;

create or replace function public.ussd_book_bus(
    p_session_id text,
    p_bus_id uuid,
    p_passenger_name text,
    p_passenger_phone text,
    p_seat_count integer,
    p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    clean_session_id text := pg_catalog.btrim(coalesce(p_session_id, ''));
    existing_booking jsonb;
    new_booking jsonb;
begin
    if clean_session_id !~ '^[A-Za-z0-9._:-]{1,128}$' then
        raise exception 'Invalid USSD session identifier.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(0, pg_catalog.hashtext(clean_session_id));
    select pg_catalog.jsonb_build_object(
        'id', bookings.id,
        'payment_status', bookings.payment_status
    )
      into existing_booking
      from public.bookings
     where bookings.ussd_session_id = clean_session_id;
    if existing_booking is not null then
        return existing_booking;
    end if;

    new_booking := public.book_bus(
        p_bus_id,
        p_passenger_name,
        p_passenger_phone,
        p_seat_count,
        p_payment_method
    );
    update public.bookings
       set ussd_session_id = clean_session_id
     where id = (new_booking ->> 'id')::uuid;
    return new_booking;
end;
$$;

grant execute on function public.book_bus(uuid, text, text, integer, text) to anon, authenticated;
revoke execute on function public.ussd_book_bus(text, uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.ussd_book_bus(text, uuid, text, text, integer, text) to service_role;
grant execute on function public.get_my_booking_by_reference(text) to authenticated;
grant execute on function public.get_company_bookings() to authenticated;
revoke execute on function public.get_company_bookings() from public, anon;
revoke execute on function public.book_bus(uuid, text, text, integer, text) from public;
revoke execute on function public.get_my_booking_by_reference(text) from public, anon;
