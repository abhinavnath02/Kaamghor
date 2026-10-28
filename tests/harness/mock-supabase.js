// Local test harness: stands in for supabase-js so the real app (index.html + api.js) can be
// clicked through without a Supabase project. Every query runs on an in-browser Postgres (PGlite)
// loaded with the real sql/01..05 files, as role "authenticated" with the signed-in user's id,
// so row-level security and the SQL functions behave as they will in production.
// Email code is always 123456; "Continue with Google" signs in google.tester@gmail.com. Razorpay is simulated: "paying" runs what the webhook would do.
// Helpers in the console: __sql('select ...') runs as superuser, __reset() wipes the database.
(function () {
  'use strict';
  const DB_NAME = 'idb://kaamghor-harness-v3';
  const STUBS = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text, phone text, phone_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id serial primary key, bucket_id text, name text, data text);
    alter table storage.objects enable row level security;
    grant select, insert on storage.objects to authenticated;
    grant usage on sequence storage.objects_id_seq to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    create publication supabase_realtime;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`;

  const isoTz = (v) => v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const ready = (async () => {
    const { PGlite } = await import('/node_modules/@electric-sql/pglite/dist/index.js');
    const db = new PGlite(DB_NAME, { parsers: { 1082: (v) => v, 1114: (v) => v, 1184: isoTz } });
    const { rows } = await db.query(`select to_regclass('auth.users') as t`);
    if (!rows[0].t) await db.exec(STUBS + ' create schema harness; create table harness.applied (name text primary key);');
    // Apply any SQL file not applied yet, in order, like running new migrations on Supabase.
    const done = new Set((await db.query('select name from harness.applied')).rows.map((r) => r.name));
    for (const f of await (await fetch('/__mock/sql-list')).json()) {
      if (done.has(f)) continue;
      await db.exec(await (await fetch('/sql/' + f)).text());
      await db.query('insert into harness.applied values ($1)', [f]);
      console.log('[mock] applied', f);
    }
    return db;
  })();

  // ---------- session ----------
  const SKEY = 'mock-session';
  const load = () => { try { return JSON.parse(localStorage.getItem(SKEY)); } catch (_) { return null; } };
  let session = load();
  const save = (s) => { session = s; if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); };
  async function uuidFor(email) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)));
    const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
  }
  async function signIn(email, meta) {
    const id = await uuidFor(email);
    const db = await ready;
    await db.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [id, email]);
    const { rows } = await db.query('select phone, phone_confirmed_at from auth.users where id = $1', [id]);
    const user = { id, email, user_metadata: meta, phone: rows[0].phone || '', phone_confirmed_at: rows[0].phone_confirmed_at };
    save({ user, access_token: 'mock' });
    return user;
  }
  // Phone numbers arrive as +91...; Supabase stores them without the plus.
  async function signInPhone(phone) {
    const p = phone.replace('+', '');
    const id = await uuidFor('phone:' + p);
    const db = await ready;
    await db.query('insert into auth.users (id, phone, phone_confirmed_at) values ($1, $2, now()) on conflict do nothing', [id, p]);
    const user = { id, email: '', user_metadata: {}, phone: p, phone_confirmed_at: new Date().toISOString() };
    save({ user, access_token: 'mock' });
    return user;
  }

  async function asUser(sql, params = []) {
    const db = await ready;
    return db.transaction(async (tx) => {
      if (session) {
        await tx.exec('set local role authenticated');
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [session.user.id]);
      } else {
        await tx.exec('set local role anon');
      }
      return tx.query(sql, params);
    });
  }
  const wrap = async (fn) => { try { return { data: await fn(), error: null }; } catch (e) { console.warn('[mock]', e.message); return { data: null, error: { message: e.message } }; } };

  // ---------- realtime ----------
  let listeners = [];
  const emit = (eventType, row) => setTimeout(() => listeners.forEach((cb) => cb({ eventType, new: row, table: 'jobs' })), 50);
  async function emitJob(id) {
    const db = await ready;
    const { rows } = await db.query('select * from public.jobs where id = $1', [id]);
    if (rows[0]) emit('UPDATE', rows[0]);
  }

  // ---------- query builder (the subset api.js uses) ----------
  const ident = (c) => '"' + c.trim().replace(/"/g, '') + '"';
  const pgArray = (arr) => '{' + arr.map((x) => '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
  const EMBED = { worker_profiles: { profiles: 'id = t.user_id' }, assignments: { jobs: 'id = t.job_id' } };

  class Query {
    constructor(table) { Object.assign(this, { table, op: 'select', cols: '*', where: [], params: [], orderBy: '', lim: '', one: 0, ret: false, opts: {} }); }
    p(v) { this.params.push(v); return '$' + this.params.length; }
    select(cols = '*', opts = {}) { if (this.op === 'select') { this.cols = cols; this.opts = opts; } else this.ret = true; return this; }
    insert(row) { this.op = 'insert'; this.row = row; return this; }
    update(row) { this.op = 'update'; this.row = row; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.where.push(`t.${ident(c)}::text = ${this.p(String(v))}`); return this; }
    neq(c, v) { this.where.push(`t.${ident(c)}::text <> ${this.p(String(v))}`); return this; }
    is(c, v) { this.where.push(`t.${ident(c)} is ${v === null ? 'null' : v}`); return this; }
    in(c, arr) { this.where.push(`t.${ident(c)}::text = any(${this.p(pgArray(arr))}::text[])`); return this; }
    contains(c, arr) { this.where.push(`t.${ident(c)} @> ${this.p(pgArray(arr))}::text[]`); return this; }
    order(c, o = {}) { this.orderBy = ` order by t.${ident(c)} ${o.ascending === false ? 'desc' : 'asc'}`; return this; }
    limit(n) { this.lim = ` limit ${Number(n)}`; return this; }
    maybeSingle() { this.one = 1; return this; }
    single() { this.one = 2; return this; }
    then(res, rej) { return this.run().then(res, rej); }

    selectList() {
      return this.cols.split(/,(?![^(]*\))/).map((part) => {
        const m = part.trim().match(/^(\w+)\((.*)\)$/);
        if (m) {
          const on = EMBED[this.table][m[1]];
          const cols = m[2].trim() === '*' ? '*' : m[2].split(',').map(ident).join(', ');
          return `(select row_to_json(e) from (select ${cols} from public.${m[1]} where ${on}) e) as ${ident(m[1])}`;
        }
        return part.trim() === '*' ? 't.*' : 't.' + ident(part);
      }).join(', ');
    }
    async run() {
      const W = this.where.length ? ' where ' + this.where.join(' and ') : '';
      const T = `public.${ident(this.table)} t`;
      try {
        let res;
        if (this.op === 'select' && this.opts.head) {
          res = await asUser(`select count(*)::int as n from ${T}${W}`, this.params);
          return { data: null, count: res.rows[0].n, error: null };
        }
        if (this.op === 'select') res = await asUser(`select ${this.selectList()} from ${T}${W}${this.orderBy}${this.lim}`, this.params);
        if (this.op === 'insert') {
          const keys = Object.keys(this.row);
          const vals = keys.map((k) => { const v = this.row[k]; return Array.isArray(v) ? this.p(pgArray(v)) : this.p(v === null ? null : String(v)); });
          res = await asUser(`insert into public.${ident(this.table)} (${keys.map(ident).join(', ')}) values (${vals.join(', ')})${this.ret || this.table === 'jobs' ? ' returning *' : ''}`, this.params);
          if (this.table === 'jobs') emit('INSERT', res.rows[0]);
        }
        if (this.op === 'update') {
          const sets = Object.entries(this.row).map(([k, v]) => `${ident(k)} = ${Array.isArray(v) ? this.p(pgArray(v)) : this.p(v === null ? null : String(v))}`);
          res = await asUser(`update ${T} set ${sets.join(', ')}${W}${this.ret ? ' returning *' : ''}`, this.params);
        }
        if (this.op === 'delete') res = await asUser(`delete from ${T}${W}`, this.params);
        const rows = res.rows;
        if (this.one === 1) return { data: rows[0] ?? null, error: null };
        if (this.one === 2) return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
        return { data: this.op === 'select' || this.ret ? rows : null, error: null };
      } catch (e) {
        console.warn('[mock]', e.message);
        return { data: null, error: { message: e.message } };
      }
    }
  }

  const ARG_TYPES = { p_job: 'uuid', p_worker: 'uuid', p_payment: 'uuid', p_rating: 'int', p_verified: 'boolean', p_ref: 'text', p_service: 'text', p_daily: 'int', p_min: 'int', p_assignment: 'uuid', p_problem: 'text', p_completed: 'boolean', p_stars: 'int', p_tags: 'text[]', p_comment: 'text', p_lat: 'double precision', p_lng: 'double precision', p_landmark: 'text' };
  const SET_RETURNING = { get_pay_target: 1, admin_payouts: 1, admin_fees_owed: 1, admin_disputes: 1 };
  // Functions that update the jobs table, so realtime would send an event.
  const JOB_CHANGING = { hire_worker: 1, complete_job: 1, stop_hiring: 1 };
  async function rpc(name, args = {}) {
    const keys = Object.keys(args);
    const call = `public.${ident(name)}(${keys.map((k, i) => `${k} => $${i + 1}::${ARG_TYPES[k]}`).join(', ')})`;
    const r = await wrap(async () => {
      const res = await asUser(SET_RETURNING[name] ? `select * from ${call}` : `select ${call} as v`, keys.map((k) => (Array.isArray(args[k]) ? pgArray(args[k]) : args[k])));
      return SET_RETURNING[name] ? res.rows : res.rows[0].v;
    });
    if (!r.error && JOB_CHANGING[name]) emitJob(args.p_job);
    return r;
  }

  // ---------- Razorpay stand-in ----------
  async function webhookPaid(orderId) {
    const db = await ready;
    await db.query(`update public.payments set status = 'paid', method = 'upi', payout_status = 'pending', paid_at = now(),
      razorpay_payment_id = 'pay_mock_' || substr(md5(random()::text), 1, 10) where razorpay_order_id = $1 and status = 'pending'`, [orderId]);
  }
  window.Razorpay = class {
    constructor(o) { this.o = o; }
    on() {}
    open() {
      console.log('[mock] Razorpay checkout opened for', this.o.order_id, this.o.amount);
      setTimeout(async () => { await webhookPaid(this.o.order_id); this.o.handler({ razorpay_order_id: this.o.order_id }); }, 800);
    }
  };
  const tag = document.createElement('script');
  tag.setAttribute('src', 'https://checkout.razorpay.com/v1/checkout.js');
  tag.type = 'text/plain';
  document.head.appendChild(tag);

  // ---------- the client ----------
  window.supabase = {
    createClient() {
      return {
        auth: {
          signInWithOtp: async ({ email, phone }) => (/@/.test(email || '') || /^\+91[6-9]\d{9}$/.test(phone || '')
            ? { data: {}, error: null } : { data: null, error: { message: 'Invalid email or phone' } }),
          verifyOtp: async ({ email, phone, token, type }) => {
            if (token !== '123456') return { data: null, error: { message: 'Token has expired or is invalid' } };
            if (type === 'phone_change') {
              const db = await ready;
              const p = phone.replace('+', '');
              await db.query('update auth.users set phone = $1, phone_confirmed_at = now() where id = $2', [p, session.user.id]);
              save({ ...session, user: { ...session.user, phone: p, phone_confirmed_at: new Date().toISOString() } });
              return { data: { user: session.user, session }, error: null };
            }
            const user = type === 'sms' ? await signInPhone(phone) : await signIn(email, {});
            return { data: { user, session }, error: null };
          },
          updateUser: async ({ phone }) => (/^\+91[6-9]\d{9}$/.test(phone || '')
            ? { data: { user: session.user }, error: null } : { data: null, error: { message: 'Invalid phone' } }),
          // Real Google leaves the page and comes back with ?code=; here we sign in a fixed Google user and reload.
          signInWithOAuth: async () => {
            await signIn('google.tester@gmail.com', { full_name: 'Google Tester' });
            location.href = location.pathname + '?code=mock';
            return { data: {}, error: null };
          },
          getSession: async () => { await ready; return { data: { session } }; },
          signOut: async () => { save(null); return { error: null }; },
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        from: (table) => new Query(table),
        rpc,
        storage: {
          from: (bucket) => ({
            upload: (path, blob) => wrap(async () => {
              const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
              await asUser('insert into storage.objects (bucket_id, name, data) values ($1, $2, $3)', [bucket, path, data]);
              return { path };
            }),
            createSignedUrl: (path) => wrap(async () => {
              const { rows } = await asUser('select data from storage.objects where bucket_id = $1 and name = $2', [bucket, path]);
              if (!rows.length) throw new Error('Object not found');
              return { signedUrl: URL.createObjectURL(await (await fetch(rows[0].data)).blob()) };
            }),
          }),
        },
        functions: {
          // Same checks as supabase/functions/create-order.
          invoke: async (name, { body }) => {
            if (name !== 'create-order') return { data: null, error: { message: 'Unknown function' } };
            const db = await ready;
            const { rows } = await db.query(`select j.household_id, p.id, p.amount, p.status as pstatus, p.razorpay_order_id
              from public.payments p join public.jobs j on j.id = p.job_id where p.id = $1`, [body.payment_id]);
            const r = rows[0];
            const fail = (m) => ({ data: null, error: { message: m, context: { json: async () => ({ error: m }) } } });
            if (!r || r.household_id !== session?.user.id) return fail('Payment not found');
            if (r.pstatus === 'paid') return fail('Already paid');
            const orderId = r.razorpay_order_id || 'order_mock_' + r.id.slice(0, 8);
            await db.query('update public.payments set razorpay_order_id = $1 where id = $2', [orderId, r.id]);
            return { data: { order_id: orderId, key_id: 'rzp_test_mock', amount: r.amount * 100, currency: 'INR' }, error: null };
          },
        },
        channel() {
          const ch = { on(_e, _f, cb) { listeners.push(cb); return ch; }, subscribe() { return ch; } };
          return ch;
        },
        removeAllChannels() { listeners = []; },
      };
    },
  };

  window.__sql = async (sql, params) => (await (await ready).query(sql, params)).rows;
  window.__reset = async () => {
    save(null);
    indexedDB.deleteDatabase(DB_NAME.replace('idb://', '/pglite/'));
    location.href = '/';
  };
})();
