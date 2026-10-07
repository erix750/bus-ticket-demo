create extension if not exists pgcrypto;

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
    created_at timestamptz not null default now(),
    check (lower(trim(from_city)) <> lower(trim(to_city)))
);

create table if not exists public.bookings (
    id uuid primary key default gen_random_uuid(),
    bus_id uuid not null references public.buses (id) on delete restrict,
    passenger_name text not null check (char_length(trim(passenger_name)) between 1 and 80),
    seat_count integer not null check (seat_count between 1 and 20),
    base_fare numeric(12, 2) not null check (base_fare >= 0),
    platform_fee numeric(12, 2) not null check (platform_fee >= 0),
    total_fare numeric(12, 2) not null check (total_fare = base_fare + platform_fee),
    payment_method text not null check (payment_method in ('MTN Mobile Money', 'Airtel Money')),
    payment_status text not null default 'demo-unpaid' check (payment_status = 'demo-unpaid'),
    cancel_token uuid not null default gen_random_uuid(),
    cancelled boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists buses_search_idx
    on public.buses (travel_date, from_city, to_city, company_id);
create index if not exists bookings_bus_id_idx on public.bookings (bus_id);
create index if not exists bookings_cancel_token_idx on public.bookings (cancel_token);

alter table public.companies enable row level security;
alter table public.buses enable row level security;
alter table public.bookings enable row level security;

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
    using (travel_date >= current_date);

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

grant usage on schema public to anon, authenticated;
grant select on public.companies, public.buses to anon, authenticated;
grant insert, delete on public.buses to authenticated;
grant update (name, from_city, to_city, travel_date, departure_time, total_seats, fare)
    on public.buses to authenticated;
grant update (name, logo_data) on public.companies to authenticated;
revoke all on public.bookings from anon, authenticated;

create or replace function public.create_company_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.companies (id, name)
    values (
        new.id,
        coalesce(
            nullif(trim(new.raw_user_meta_data ->> 'company_name'), ''),
            split_part(new.email, '@', 1)
        )
    );
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
    base_amount numeric(12, 2);
    fee_amount numeric(12, 2);
begin
    if char_length(clean_name) not between 1 and 80 then
        raise exception 'Enter a passenger name of 1 to 80 characters.';
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
       and travel_date >= current_date
     for update;

    if not found or selected_bus.available_seats < p_seat_count then
        raise exception 'Those seats are no longer available. Search again.';
    end if;

    base_amount := selected_bus.fare * p_seat_count;
    fee_amount := 10 * p_seat_count;

    update public.buses
       set available_seats = available_seats - p_seat_count
     where id = selected_bus.id;

    insert into public.bookings (
        bus_id, passenger_name, seat_count, base_fare, platform_fee,
        total_fare, payment_method
    )
    values (
        selected_bus.id, clean_name, p_seat_count, base_amount, fee_amount,
        base_amount + fee_amount, p_payment_method
    )
    returning * into new_booking;

    return jsonb_build_object(
        'id', new_booking.id,
        'bus_id', new_booking.bus_id,
        'passenger_name', new_booking.passenger_name,
        'company_id', selected_bus.company_id,
        'bus_name', selected_bus.name,
        'from_city', selected_bus.from_city,
        'to_city', selected_bus.to_city,
        'travel_date', selected_bus.travel_date,
        'departure_time', selected_bus.departure_time,
        'seat_count', new_booking.seat_count,
        'base_fare', new_booking.base_fare,
        'platform_fee', new_booking.platform_fee,
        'total_fare', new_booking.total_fare,
        'payment_method', new_booking.payment_method,
        'payment_status', new_booking.payment_status,
        'cancelled', new_booking.cancelled,
        'cancel_token', new_booking.cancel_token
    );
end;
$$;

create or replace function public.get_my_bookings(p_cancel_tokens uuid[])
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'id', bookings.id,
        'bus_id', bookings.bus_id,
        'passenger_name', bookings.passenger_name,
        'company_id', buses.company_id,
        'company_name', companies.name,
        'company_logo', companies.logo_data,
        'bus_name', buses.name,
        'from_city', buses.from_city,
        'to_city', buses.to_city,
        'travel_date', buses.travel_date,
        'departure_time', buses.departure_time,
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
    where bookings.cancel_token = any(coalesce(p_cancel_tokens, array[]::uuid[]))
    order by bookings.created_at desc;
$$;

create or replace function public.cancel_my_booking(
    p_booking_id uuid,
    p_cancel_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_booking public.bookings%rowtype;
begin
    select *
      into selected_booking
      from public.bookings
     where id = p_booking_id
       and cancel_token = p_cancel_token
       and cancelled = false
     for update;

    if not found then
        return false;
    end if;

    update public.bookings set cancelled = true where id = selected_booking.id;
    update public.buses
       set available_seats = least(total_seats, available_seats + selected_booking.seat_count)
     where id = selected_booking.bus_id;

    return true;
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
        'company_id', buses.company_id,
        'company_name', companies.name,
        'company_logo', companies.logo_data,
        'bus_name', buses.name,
        'from_city', buses.from_city,
        'to_city', buses.to_city,
        'travel_date', buses.travel_date,
        'departure_time', buses.departure_time,
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

grant execute on function public.book_bus(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.get_my_bookings(uuid[]) to anon, authenticated;
grant execute on function public.cancel_my_booking(uuid, uuid) to anon, authenticated;
grant execute on function public.get_company_bookings() to authenticated;
revoke execute on function public.get_company_bookings() from public, anon;
revoke execute on function public.book_bus(uuid, text, integer, text) from public;
revoke execute on function public.get_my_bookings(uuid[]) from public;
revoke execute on function public.cancel_my_booking(uuid, uuid) from public;
