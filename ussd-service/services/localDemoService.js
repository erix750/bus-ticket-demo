const { randomUUID } = require("node:crypto");

function rwandaDateTime(now) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Kigali",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(now || new Date()).reduce(function(result, part) {
        result[part.type] = part.value;
        return result;
    }, {});
    return {
        date: parts.year + "-" + parts.month + "-" + parts.day,
        time: parts.hour + ":" + parts.minute
    };
}

function shiftRwandaDateTime(date, time, minutes) {
    const shifted = new Date(date + "T" + time + ":00Z");
    shifted.setUTCMinutes(shifted.getUTCMinutes() + minutes);
    return {
        date: shifted.toISOString().slice(0, 10),
        time: shifted.toISOString().slice(11, 16)
    };
}

function createSeedBuses(fareService) {
    const now = rwandaDateTime();
    const todayFirst = shiftRwandaDateTime(now.date, now.time, 90);
    const todaySecond = shiftRwandaDateTime(now.date, now.time, 240);
    const tomorrow = shiftRwandaDateTime(now.date, now.time, 24 * 60);
    const schedules = [
        ["Kigali", "Huye", todayFirst.date, todayFirst.time, "Volcano Express", 120, "intercity", 32],
        ["Kigali", "Huye", todaySecond.date, todaySecond.time, "Ritco Coach", 125, "intercity", 28],
        ["Kigali", "Musanze", tomorrow.date, "08:00", "Northern Star", 95, "intercity", 24],
        ["Kigali", "Rubavu", tomorrow.date, "09:30", "Lake Line", 155, "intercity", 36],
        ["Huye", "Kigali", tomorrow.date, "11:00", "Southern Routes", 120, "intercity", 30],
        ["Kigali", "Nyagatare", tomorrow.date, "13:00", "Eastern Link", 165, "intercity", 26]
    ];

    return schedules.map(function(item) {
        return {
            id: randomUUID(),
            from_city: item[0],
            to_city: item[1],
            travel_date: item[2],
            departure_time: item[3] + ":00",
            name: item[4],
            available_seats: item[7],
            total_seats: item[7],
            route_distance_km: item[5],
            fare_category: item[6],
            fare: fareService.calculate(item[5], item[6]),
            is_active: true,
            companies: { name: item[4] }
        };
    });
}

function copy(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class DemoQuery {
    constructor(client, table) {
        this.client = client;
        this.table = table;
        this.filters = [];
        this.orders = [];
        this.operation = "select";
        this.limitCount = Infinity;
        this.record = null;
    }

    select() { return this; }

    eq(field, value) { this.filters.push({ field: field, operator: "eq", value: value }); return this; }
    gt(field, value) { this.filters.push({ field: field, operator: "gt", value: value }); return this; }
    gte(field, value) { this.filters.push({ field: field, operator: "gte", value: value }); return this; }
    lt(field, value) { this.filters.push({ field: field, operator: "lt", value: value }); return this; }
    order(field, options) { this.orders.push({ field: field, ascending: !options || options.ascending !== false }); return this; }
    limit(count) { this.limitCount = count; return this; }

    upsert(record) {
        this.operation = "upsert";
        this.record = copy(record);
        return this;
    }

    delete() {
        this.operation = "delete";
        return this;
    }

    async maybeSingle() {
        const result = await this.execute();
        return { data: result.data[0] || null, error: result.error };
    }

    then(resolve, reject) {
        return this.execute().then(resolve, reject);
    }

    async execute() {
        if (this.table === "ussd_sessions") return this.executeSessions();
        if (this.table !== "buses" || this.operation !== "select") {
            return { data: null, error: { message: "Unsupported local demo database request." } };
        }

        let rows = this.client.buses.filter((row) => this.matches(row));
        for (const order of this.orders.slice().reverse()) {
            rows = rows.slice().sort((first, second) => {
                const a = first[order.field];
                const b = second[order.field];
                const comparison = a < b ? -1 : a > b ? 1 : 0;
                return order.ascending ? comparison : -comparison;
            });
        }
        return { data: copy(rows.slice(0, this.limitCount)), error: null };
    }

    async executeSessions() {
        if (this.operation === "upsert") {
            this.client.sessions.set(this.record.session_id, copy(this.record));
            return { data: null, error: null };
        }
        if (this.operation === "delete") {
            for (const [sessionId, record] of this.client.sessions) {
                if (this.matches(record)) this.client.sessions.delete(sessionId);
            }
            return { data: null, error: null };
        }
        const rows = Array.from(this.client.sessions.values())
            .filter((record) => this.matches(record))
            .map(copy);
        return { data: rows.slice(0, this.limitCount), error: null };
    }

    matches(row) {
        return this.filters.every((filter) => {
            const value = row[filter.field];
            if (filter.operator === "eq") return value === filter.value;
            if (filter.operator === "gt") return value > filter.value;
            if (filter.operator === "gte") return value >= filter.value;
            if (filter.operator === "lt") return value < filter.value;
            return false;
        });
    }
}

function createLocalDemoService(fareService) {
    const client = {
        buses: createSeedBuses(fareService),
        sessions: new Map(),
        bookings: new Map(),
        from: function(table) { return new DemoQuery(client, table); },
        rpc: async function(name, parameters) {
            if (name !== "ussd_book_bus") {
                return { data: null, error: { message: "Unsupported local demo database function." } };
            }

            const existing = client.bookings.get(parameters.p_session_id);
            if (existing) return { data: copy(existing), error: null };

            const bus = client.buses.find(function(item) {
                return item.id === parameters.p_bus_id;
            });
            const phone = String(parameters.p_passenger_phone || "").trim();
            const nameIsValid = typeof parameters.p_passenger_name === "string" &&
                parameters.p_passenger_name.trim().length >= 2 &&
                parameters.p_passenger_name.trim().length <= 80;
            if (!bus || !bus.is_active || bus.available_seats < parameters.p_seat_count ||
                !nameIsValid || !/^\+2507[0-9]{8}$/.test(phone) ||
                !["MTN Mobile Money", "Airtel Money"].includes(parameters.p_payment_method)) {
                return { data: null, error: { message: "Trip or requested seats are no longer available." } };
            }

            const now = rwandaDateTime();
            const departure = {
                date: bus.travel_date,
                time: String(bus.departure_time).slice(0, 5)
            };
            if (departure.date < now.date ||
                (departure.date === now.date && departure.time <= now.time)) {
                return { data: null, error: { message: "The selected trip has already departed." } };
            }

            bus.available_seats -= parameters.p_seat_count;
            const booking = {
                id: randomUUID(),
                bus_id: bus.id,
                passenger_name: parameters.p_passenger_name.trim(),
                passenger_phone: phone,
                seat_count: parameters.p_seat_count,
                base_fare: bus.fare * parameters.p_seat_count,
                platform_fee: 0,
                total_fare: bus.fare * parameters.p_seat_count,
                payment_method: parameters.p_payment_method,
                payment_status: "demo-unpaid",
                cancelled: false,
                company_name: bus.companies.name,
                bus_name: bus.name,
                from_city: bus.from_city,
                to_city: bus.to_city,
                travel_date: bus.travel_date,
                departure_time: bus.departure_time
            };
            client.bookings.set(parameters.p_session_id, booking);
            return { data: copy(booking), error: null };
        }
    };

    return {
        client: client,
        bookings: function() { return Array.from(client.bookings.values()).map(copy); },
        trips: function() { return client.buses.map(copy); },
        source: "Sample trips stored in this local prototype; data is not connected to Supabase."
    };
}

module.exports = { createLocalDemoService };
