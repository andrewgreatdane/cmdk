/* Resilience Systems admin — shared data layer, auth and helpers.
   Two backends behind one API: Supabase (live) or localStorage (demo). */
(function () {
  const CFG = window.RS_CONFIG || {};
  const LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY && window.supabase);
  const sb = LIVE ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY) : null;
  const TABLES = ['settings', 'categories', 'gear', 'customers', 'customer_gear', 'modules', 'customer_modules'];
  const LS_KEY = 'rs-admin-demo-v1';

  /* ---------- local backend ---------- */
  function lsLoad() {
    try { const d = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (d) return d; } catch (e) {}
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
      if (t === 'customers') { mem.customer_gear = mem.customer_gear.filter(x => x.customer_id !== id); mem.customer_modules = mem.customer_modules.filter(x => x.customer_id !== id); }
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
    const nav = [['customers.html', 'Customers'], ['gear.html', 'Master gear'], ['training.html', 'Training']];
    const h = document.createElement('header'); h.className = 'adm-header';
    h.innerHTML = `
      <a href="../index.html" class="adm-brand" aria-label="Resilience Systems site"><span class="adm-emblem" aria-hidden="true">R<span>/</span></span><span class="adm-brandname">Resilience<br>Systems</span></a>
      <nav class="adm-nav" aria-label="Admin">${nav.map(([href, label], i) => `<a href="${href}" ${active === href ? 'aria-current="page"' : ''}><small>0${i + 1}</small>${label}</a>`).join('')}</nav>
      <div class="adm-user">${LIVE ? '' : '<span class="adm-demo" title="Data is stored in this browser only">Demo</span>'}<span>${esc(user && user.name || '')}</span><button type="button" class="adm-link" id="adm-signout">Sign out</button></div>`;
    document.body.prepend(h);
    h.querySelector('#adm-signout').addEventListener('click', () => auth.signOut());
  }

  window.RS = { store, auth, ensureSeed, settings, money, esc, toast, header, live: LIVE, uid };
})();
