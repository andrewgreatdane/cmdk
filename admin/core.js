/* Resilience Systems admin — shared data layer, auth and helpers.
   Two backends behind one API: Supabase (live) or localStorage (demo). */
(function () {
  const CFG = window.RS_CONFIG || {};
  const LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY && window.supabase);
  const sb = LIVE ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY) : null;
  const TABLES = ['settings', 'categories', 'gear', 'customers', 'customer_gear', 'modules', 'customer_modules', 'tasks', 'members'];
  const LS_KEY = 'rs-admin-demo-v1';

  /* ---------- local backend ---------- */
  function lsLoad() {
    try { const d = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (d) { TABLES.forEach(t => (d[t] = d[t] || [])); return d; } } catch (e) {}
    const d = {}; TABLES.forEach(t => (d[t] = [])); return d;
  }
  let mem = LIVE ? null : lsLoad();
  function lsSave() { try { localStorage.setItem(LS_KEY, JSON.stringify(mem)); } catch (e) { console.warn('demo save failed', e); } }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now());

  const local = {
    async list(t) { return (mem[t] || []).map(r => ({ ...r })); },
    async insert(t, row) {
      const r = { id: row.id || uid(), created_at: new Date().toISOString(), ...row };
      if (t === 'settings') { mem[t] = mem[t].filter(x => x.key !== r.key); }
      mem[t].push(r); lsSave(); return { ...r };
    },
    async insertMany(t, rows) { const out = []; for (const r of rows) out.push(await local.insert(t, r)); return out; },
    async update(t, id, patch) { const r = mem[t].find(x => x.id === id); if (r) Object.assign(r, patch); lsSave(); return r ? { ...r } : null; },
    async remove(t, id) {
      mem[t] = mem[t].filter(x => x.id !== id);
      // emulate FK cascades
      if (t === 'customers') { mem.customer_gear = mem.customer_gear.filter(x => x.customer_id !== id); mem.customer_modules = mem.customer_modules.filter(x => x.customer_id !== id); mem.tasks = mem.tasks.filter(x => x.customer_id !== id); mem.members = mem.members.filter(x => x.customer_id !== id); }
      if (t === 'gear') mem.customer_gear = mem.customer_gear.filter(x => x.gear_id !== id);
      if (t === 'modules') mem.customer_modules = mem.customer_modules.filter(x => x.module_id !== id);
      if (t === 'categories') mem.gear.forEach(g => { if (g.category_id === id) g.category_id = null; });
      lsSave();
    },
    async setSetting(key, value) { const r = mem.settings.find(s => s.key === key); if (r) r.value = String(value); else mem.settings.push({ key, value: String(value) }); lsSave(); },
  };

  /* ---------- supabase backend ---------- */
  function chk({ data, error }) { if (error) { RS.toast(error.message, true); throw error; } return data; }
  const remote = {
    async list(t) {
      let q = sb.from(t).select('*');
      if (t !== 'settings') q = q.order('created_at', { ascending: true }).order('id');
      return chk(await q.range(0, 4999));
    },
    async insert(t, row) { return chk(await sb.from(t).insert(row).select().single()); },
    async insertMany(t, rows) { return rows.length ? chk(await sb.from(t).insert(rows).select()) : []; },
    async update(t, id, patch) { return chk(await sb.from(t).update(patch).eq('id', id).select().single()); },
    async remove(t, id) { chk(await sb.from(t).delete().eq('id', id)); },
    async setSetting(key, value) { chk(await sb.from('settings').upsert({ key, value: String(value) })); },
  };

  const store = LIVE ? remote : local;

  /* ---------- auth ---------- */
  const DEMO_USER = 'rs-admin-demo-user';
  const auth = {
    live: LIVE,
    async signIn(email, password) {
      if (!LIVE) { sessionStorage.setItem(DEMO_USER, email); return; }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async sendLink(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + '/admin/customers.html' } });
      if (error) throw error;
    },
    async setPassword(pw) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; },
    async token() { if (!LIVE) return null; const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : null; },
    async signOut() { if (LIVE) await sb.auth.signOut(); sessionStorage.removeItem(DEMO_USER); location.href = 'index.html'; },
    async current() {
      if (!LIVE) {
        const email = sessionStorage.getItem(DEMO_USER); if (!email) return null;
        const a = (CFG.ADMINS || []).find(x => x.email === email); return a ? { ...a } : null;
      }
      const { data } = await sb.auth.getSession();
      const email = data.session && data.session.user.email; if (!email) return null;
      const { data: rows } = await sb.from('admins').select('name,email').ilike('email', email);
      if (!rows || !rows.length) return { email, name: null, denied: true };
      return rows[0];
    },
    async guard() {
      const u = await auth.current();
      if (!u) { location.href = 'index.html'; throw new Error('redirect'); }
      if (u.denied) { await sb.auth.signOut(); location.href = 'index.html?denied=1'; throw new Error('denied'); }
      return u;
    },
  };

  /* ---------- seeding ---------- */
  async function ensureSeed() {
    const cats = await store.list('categories');
    if (cats.length) return false;
    const S = window.RS_SEED; if (!S) return false;
    const made = await store.insertMany('categories', S.categories.map(c => ({ name: c.name, sort: c.sort })));
    const catId = {}; S.categories.forEach((c, i) => (catId[c.key] = made.find(m => m.name === c.name && m.sort === c.sort).id));
    const gearRows = S.gear.map(g => {
      const { key, cat, ...rest } = g; return { ...rest, category_id: catId[cat] };
    });
    for (let i = 0; i < gearRows.length; i += 10) await store.insertMany('gear', gearRows.slice(i, i + 10));
    await store.insertMany('modules', S.modules.map((m, i) => ({ title: m.title, description: m.description, duration_min: m.duration_min, links: m.links, sort: i })));
    await store.setSetting('usd_cad', '1.37');
    await store.setSetting('markup', '1.00');
    if (!LIVE) { // a sample client so the demo has something to show
      const gear = await store.list('gear'); const mods = await store.list('modules');
      const c = await store.insert('customers', { name: 'Sample client', email: 'sample@example.com', phone: '', household: '2 adults, 2 children', location: 'West Vancouver', status: 'Design', notes: 'Demo record. Delete any time.' });
      const pick = ['Pelican 1535 Air Carry-On Case', 'Pelican 1535AirDS Padded Divider Set', 'Mountain Radio Kit — 2 Radios + 2 Headsets', 'ThinkNode M7 LoRa Gateway Node', 'LilyGo T-Deck Plus', 'Goal Zero Venture 75 Power Bank'];
      for (const n of pick) { const g = gear.find(x => x.name === n); if (g) await store.insert('customer_gear', { customer_id: c.id, gear_id: g.id, qty: n.includes('T-Deck') ? 2 : 1, sell_cad: null }); }
      for (let i = 0; i < 3; i++) await store.insert('customer_modules', { customer_id: c.id, module_id: mods[i].id, position: i });
    }
    return true;
  }

  async function settings() {
    const rows = await store.list('settings'); const o = {};
    rows.forEach(r => (o[r.key] = r.value));
    return { rate: parseFloat(o.usd_cad) || 1.37, markup: parseFloat(o.markup) || 1 };
  }

  /* ---------- money / volume ---------- */
  const money = {
    cad: (n) => '$' + (Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    whole: (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-CA'),
    costCAD: (g, s) => (g.currency === 'USD' ? Number(g.price) * s.rate : Number(g.price)) || 0,
    sellCAD: (g, s, override) => {
      if (override != null && override !== '') return Number(override);
      if (g.sell_cad != null && g.sell_cad !== '') return Number(g.sell_cad);
      return money.costCAD(g, s) * s.markup;
    },
  };

  /* ---------- UI helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(msg, bad) {
    let el = document.getElementById('rs-toast');
    if (!el) { el = document.createElement('div'); el.id = 'rs-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => (el.className = ''), 2600);
  }
  function header(active, user) {
    const nav = [['customers.html', 'Customers'], ['map.html', 'Map'], ['gear.html', 'Master gear'], ['training.html', 'Training'], ['schedule.html', 'Schedule']];
    const h = document.createElement('header'); h.className = 'adm-header';
    const title = { 'customers.html': 'Customers', 'map.html': 'Map', 'gear.html': 'Master Gear', 'training.html': 'Training', 'schedule.html': 'Schedule' }[active] || 'Admin';
    h.innerHTML = `
      <div class="adm-top"><a href="../index.html" class="adm-name">Resilience Systems · ${title}<small>Admin</small></a><div class="adm-slot" id="adm-slot"></div></div>
      <nav class="adm-nav adm-user" aria-label="Admin">${nav.map(([href, label]) => `<a href="${href}" ${active === href ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
        <span class="sp"></span>${LIVE ? '' : '<span class="adm-demo" title="Data is stored in this browser only">DEMO</span>'}<span class="who">${esc(user && user.name || '')}</span><button type="button" class="adm-link" id="adm-signout">Sign out</button></nav>`;
    document.body.prepend(h);
    h.querySelector('#adm-signout').addEventListener('click', () => auth.signOut());
  }

  /* geocoding (OpenStreetMap Nominatim, max 1 request/sec) */
  let lastGeo = 0;
  async function geocode(q) {
    if (!q || !q.trim()) return null;
    const wait = Math.max(0, 1100 - (Date.now() - lastGeo)); if (wait) await new Promise(r => setTimeout(r, wait));
    lastGeo = Date.now();
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } });
      const j = await r.json(); if (j && j[0]) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
    } catch (e) {}
    return null;
  }
  const fmtDate = d => d ? new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  // Tick a task done/undone. Finishing an annual check books the next one a year out.
  async function completeTask(t, done, list) {
    const patch = { done_at: done ? new Date().toISOString() : null };
    Object.assign(t, await store.update('tasks', t.id, patch));
    if (done && t.kind === 'Annual check' && t.customer_id) {
      const d = new Date(t.due_date + 'T12:00:00'); d.setFullYear(d.getFullYear() + 1);
      const next = d.toISOString().slice(0, 10);
      if (!list.some(x => x.customer_id === t.customer_id && x.kind === 'Annual check' && !x.done_at && x.due_date === next)) {
        list.push(await store.insert('tasks', { customer_id: t.customer_id, kind: 'Annual check', title: t.title, due_date: next, assignee: t.assignee, done_at: null }));
        toast('Next annual check booked for ' + fmtDate(next));
      }
    }
  }
  const TASK_KINDS =['Consultation', 'Delivery', 'Training session', 'Annual check', 'Refresh / restock', 'Follow-up', 'Other'];
  const ADMIN_NAMES = (CFG.ADMINS || []).map(a => a.name);

  window.RS = { geocode, fmtDate, TASK_KINDS, ADMIN_NAMES, completeTask, store, auth, ensureSeed, settings, money, esc, toast, header, live: LIVE, uid };
})();
