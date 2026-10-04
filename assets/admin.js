/* ===== Alora admin app ===== */
(function () {
  'use strict';
  const A = window.Alora, CFG = window.ALORA_CONFIG, esc = A.esc;
  const $ = id => document.getElementById(id);
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'alora-admin-auth' },
  });
  const BUCKET = 'alora-media';
  const S = { user: null, counts: { messages: 0, requests: 0, touchups: 0 }, team: null, settings: null, day: null, cust: null, ctab: 'overview', search: '' };
  let H = {}; // click handlers for the current screen and sheet

  // ---------- helpers ----------
  async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
  function errMsg(e) {
    const m = String((e && (e.message || e.error_description)) || '');
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return A.errorText('offline');
    if (/JWT|not_authorized|row-level security|permission denied/i.test(m)) return 'Your session expired. Please sign in again.';
    if (/first_name_required/.test(m)) return 'A first name is required.';
    if (/Invalid login credentials/i.test(m)) return 'That email and password don\'t match.';
    const known = A.errorText(m.trim());
    return known !== A.errorText('__') ? known : (m || 'Something went wrong. Please try again.');
  }
  async function run(fn, btn, okMsg) {
    if (btn) btn.classList.add('busy');
    try { await fn(); if (okMsg) toast(okMsg); return true; }
    catch (e) {
      console.error(e); toast(errMsg(e), true);
      if (/JWT|session/i.test(String(e && e.message))) { const { data } = await sb.auth.getSession(); if (!data.session) renderLogin(); }
      return false;
    } finally { if (btn) btn.classList.remove('busy'); }
  }
  let tt;
  function toast(t, err) { const el = $('toast'); el.textContent = t; el.classList.toggle('err', !!err); el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), err ? 4200 : 2600); }
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  const fullName = c => [c.first_name, c.last_name].filter(Boolean).join(' ');
  const linkFor = c => `${location.origin}/h/${c.token}`;
  const statusPill = s => ({ scheduled: '<span class="pill gray">Scheduled</span>', on_the_way: '<span class="pill blue">On the way</span>', arrived: '<span class="pill blue">Cleaning</span>', finished: '<span class="pill green">Finished</span>', skipped: '<span class="pill amber">Skipped</span>', cancelled: '<span class="pill red">Cancelled</span>' })[s] || '';
  const custPill = s => ({ active: '<span class="pill green">Active</span>', paused: '<span class="pill amber">Paused</span>', cancelled: '<span class="pill gray">Cancelled</span>' })[s] || '';
  async function getTeam(force) { if (!S.team || force) S.team = await q(sb.from('team_members').select('*').order('name')); return S.team; }
  async function getSettings(force) { if (!S.settings || force) S.settings = await q(sb.from('app_settings').select('*').eq('id', 1).single()); return S.settings; }
  const teamName = id => { const t = (S.team || []).find(x => x.id === id); return t ? t.name : ''; };

  // ---------- forms ----------
  function fieldHTML(f, v) {
    const id = 'f_' + f.k, cls = f.full ? 'full' : '';
    const val = v == null ? '' : v;
    const label = `<label class="f" for="${id}">${esc(f.label)}${f.req ? ' *' : ''}</label>`;
    const hint = f.hint ? `<div class="note-hint">${esc(f.hint)}</div>` : '';
    switch (f.type) {
      case 'textarea': return `<div class="${cls || 'full'}">${label}<textarea id="${id}" rows="${f.rows || 3}">${esc(val)}</textarea>${hint}</div>`;
      case 'lines': return `<div class="full">${label}<textarea id="${id}" rows="${f.rows || 6}">${esc((val || []).join('\n'))}</textarea><div class="small muted" style="margin-top:4px">One item per line</div></div>`;
      case 'select': return `<div class="${cls}">${label}<select id="${id}">${f.options.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>${hint}</div>`;
      case 'checkbox': return `<div class="${cls}"><label class="check"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
      case 'color': return `<div class="${cls}">${label}<input type="color" id="${id}" value="${esc(val || '#0380F4')}"></div>`;
      default: return `<div class="${cls}">${label}<input type="${f.type || 'text'}" id="${id}" value="${esc(val)}" ${f.step ? `step="${f.step}"` : ''} ${f.list ? `list="${f.list}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>${hint}</div>`;
    }
  }
  function readFields(fields) {
    const o = {};
    for (const f of fields) {
      const el = $('f_' + f.k); if (!el) continue;
      if (f.type === 'checkbox') o[f.k] = el.checked;
      else if (f.type === 'number') o[f.k] = el.value === '' ? null : Number(el.value);
      else if (f.type === 'lines') o[f.k] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
      else { const t = el.value.trim(); o[f.k] = t === '' ? null : t; }
      if (f.req && (o[f.k] == null || o[f.k] === '')) throw new Error(`${f.label} is required.`);
    }
    return o;
  }
  const WINDOWS = `<datalist id="windows"><option value="8:00 to 8:30 AM"><option value="9:00 to 9:30 AM"><option value="10:00 to 10:30 AM"><option value="12:00 to 12:30 PM"><option value="1:00 to 1:30 PM"><option value="2:00 to 2:30 PM"></datalist>`;

  // ---------- sheet ----------
  function openSheet(html) { $('sheetBody').innerHTML = '<div class="grabber"></div>' + html; $('sheet').classList.add('open'); $('scrim').classList.add('open'); document.body.style.overflow = 'hidden'; $('sheetBody').scrollTop = 0; }
  function closeSheet() { $('sheet').classList.remove('open'); $('scrim').classList.remove('open'); document.body.style.overflow = ''; }
  $('scrim').addEventListener('click', closeSheet);
  function editSheet({ title, sub, fields, values, onSave, onDelete, extra, saveLabel }) {
    openSheet(`<h2>${esc(title)}</h2>${sub ? `<p class="muted small">${sub}</p>` : ''}
      <div class="form" style="margin-top:8px">${fields.map(f => fieldHTML(f, (values || {})[f.k] ?? f.def)).join('')}</div>${extra || ''}
      <div class="sheet-actions">${onDelete ? '<button type="button" class="btn danger" data-act="sheet-delete">Delete</button>' : ''}<button type="button" class="btn soft" data-act="sheet-cancel">Cancel</button><button type="button" class="btn" data-act="sheet-save">${saveLabel || 'Save'}</button></div>`);
    H['sheet-cancel'] = closeSheet;
    H['sheet-save'] = async btn => { let data; try { data = readFields(fields); } catch (e) { toast(e.message, true); return; } if (await run(() => onSave(data), btn, 'Saved')) closeSheet(); };
    if (onDelete) H['sheet-delete'] = async btn => { if (!confirm('Delete this? This can\'t be undone.')) return; if (await run(onDelete, btn, 'Deleted')) closeSheet(); };
  }

  // ---------- global clicks ----------
  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-go]');
    if (nav) { e.preventDefault(); go(nav.dataset.go); return; }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = H[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  // ---------- auth ----------
  function renderLogin(msg) {
    H = {};
    $('root').innerHTML = `<div class="login"><div class="card"><img src="/assets/logo-blue.png" alt="Alora">
      <h1 style="font-size:26px">Admin sign in</h1><p class="muted small" style="margin-top:6px">${esc(msg || 'Only for the Alora team.')}</p>
      <form id="loginForm" style="margin-top:14px"><label class="f" for="em">Email</label><input type="email" id="em" autocomplete="username" required>
      <label class="f" for="pw">Password</label><input type="password" id="pw" autocomplete="current-password" required>
      <button class="btn block" style="margin-top:18px" id="loginBtn">Sign in</button></form>
      <button type="button" class="btn soft block" style="margin-top:10px" data-act="forgot">Forgot password</button></div></div>`;
    $('loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      await run(async () => { const { error } = await sb.auth.signInWithPassword({ email: $('em').value.trim(), password: $('pw').value }); if (error) throw error; await afterSignIn(); }, $('loginBtn'));
    });
    H.forgot = async btn => {
      const email = $('em').value.trim(); if (!email) { toast('Type your email first', true); return; }
      await run(async () => { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/admin' }); if (error) throw error; }, btn, 'Check your email for a reset link');
    };
  }
  function renderSetPassword() {
    H = {};
    $('root').innerHTML = `<div class="login"><div class="card"><img src="/assets/logo-blue.png" alt="Alora"><h1 style="font-size:26px">Set a new password</h1>
      <label class="f" for="np">New password</label><input type="password" id="np" autocomplete="new-password" minlength="8">
      <button type="button" class="btn block" style="margin-top:18px" data-act="setpw">Save password</button></div></div>`;
    H.setpw = async btn => {
      const pw = $('np').value; if (pw.length < 8) { toast('Use at least 8 characters', true); return; }
      if (await run(async () => { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; }, btn, 'Password updated')) afterSignIn();
    };
  }
  async function afterSignIn() {
    const { data } = await sb.auth.getSession();
    if (!data.session) { renderLogin(); return; }
    S.user = data.session.user;
    let isAdmin = false;
    try { const rows = await q(sb.from('admins').select('user_id').eq('user_id', S.user.id)); isAdmin = rows.length > 0; } catch (e) { renderLogin(errMsg(e)); return; }
    if (!isAdmin) { await sb.auth.signOut(); renderLogin('This account is not set up as an Alora admin.'); return; }
    await Promise.allSettled([getTeam(true), getSettings(true)]);
    refreshCounts();
    route();
  }
  sb.auth.onAuthStateChange((ev) => {
    if (ev === 'PASSWORD_RECOVERY') renderSetPassword();
    if (ev === 'SIGNED_OUT') { S.user = null; renderLogin(); }
  });

  // ---------- routing + shell ----------
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  window.addEventListener('hashchange', () => { if (S.user) route(); });
  const NAV = [['#/today', 'Today', '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>'], ['#/customers', 'Homes', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>'], ['#/inbox', 'Inbox', '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'], ['#/team', 'Team', '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5M15 14.6c2.6.2 4.6 2 5.5 5.4"/>'], ['#/settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>']];
  function shell(active, content) {
    const inbox = S.counts.messages + S.counts.requests + S.counts.touchups;
    const navBtns = NAV.map(([h, l, p]) => `<button type="button" class="nav" data-go="${h}" ${active === h ? 'aria-current="page"' : ''}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>${l}${h === '#/inbox' && inbox ? `<span class="count">${inbox}</span>` : ''}</button>`).join('');
    return `<div class="shell"><aside class="side"><img src="/assets/logo-blue.png" alt="Alora">${navBtns}<div class="spacer"></div><button type="button" class="nav" data-act="signout">Sign out</button></aside>
      <main class="main"><div class="mobile-head"><img src="/assets/logo-blue.png" alt="Alora"><span class="small muted">Admin</span></div><div id="content">${content}</div></main>
      <nav class="bottom-nav">${navBtns}</nav></div>`;
  }
  async function route() {
    closeSheet(); H = { signout: async () => { await sb.auth.signOut(); } };
    const parts = (location.hash || '#/today').replace(/^#\/?/, '').split('/');
    const page = parts[0] || 'today';
    const active = page === 'c' ? '#/customers' : '#/' + page;
    $('root').innerHTML = shell(active, '<div class="loading">Loading…</div>');
    window.scrollTo(0, 0);
    try {
      if (page === 'today') await viewToday();
      else if (page === 'customers') await viewCustomers();
      else if (page === 'c' && parts[1]) { S.ctab = parts[2] || 'overview'; await viewCustomer(parts[1]); }
      else if (page === 'inbox') await viewInbox();
      else if (page === 'team') await viewTeam();
      else if (page === 'settings') await viewSettings();
      else go('#/today');
    } catch (e) {
      console.error(e);
      $('content').innerHTML = `<div class="card"><h2>Couldn't load this page</h2><p class="muted" style="margin:6px 0 14px">${esc(errMsg(e))}</p><button type="button" class="btn" data-act="reload">Try again</button></div>`;
      H.reload = () => route();
    }
  }
  const setContent = html => { $('content').innerHTML = html; };
  async function refreshCounts() {
    try {
      const [m, r, t] = await Promise.all([
        sb.from('messages').select('id', { count: 'exact', head: true }).eq('sender', 'client').eq('read_by_admin', false),
        sb.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        sb.from('touchups').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      ]);
      const next = { messages: m.count || 0, requests: r.count || 0, touchups: t.count || 0 };
      const changed = JSON.stringify(next) !== JSON.stringify(S.counts);
      S.counts = next;
      if (changed) document.querySelectorAll('.nav[data-go="#/inbox"]').forEach(b => { const c = b.querySelector('.count'); const n = next.messages + next.requests + next.touchups; if (c) { c.textContent = n; if (!n) c.remove(); } else if (n) b.insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`); });
    } catch (_) { }
  }
  setInterval(() => { if (S.user && document.visibilityState === 'visible') refreshCounts(); }, 45000);

  // ---------- TODAY ----------
  async function viewToday() {
    const day = S.day || A.isoDate(A.today());
    const d = A.parseDate(day);
    const visits = await q(sb.from('visits').select('*, customers(id,first_name,last_name,address,price,cadence_days,token)').eq('scheduled_date', day).order('window_label'));
    const ids = [...new Set(visits.map(v => v.customer_id))];
    const areas = ids.length ? await q(sb.from('care_areas').select('*').in('customer_id', ids).eq('active', true)) : [];
    await getTeam();
    const done = visits.filter(v => v.status === 'finished').length;
    const live = visits.filter(v => !['cancelled', 'skipped'].includes(v.status));
    setContent(`<div class="head"><div><h1>${A.isoDate(A.today()) === day ? 'Today' : esc(A.fmt(d, { weekday: 'long' }))}</h1><p class="muted">${esc(A.fmt(d, { month: 'long', day: 'numeric', year: 'numeric' }))}</p></div>
      <div class="row"><button type="button" class="btn soft sm" data-act="day" data-n="-1">Previous</button><button type="button" class="btn soft sm" data-act="day" data-n="0">Today</button><button type="button" class="btn soft sm" data-act="day" data-n="1">Next</button></div></div>
      <div class="stats"><div class="card stat"><b>${live.length}</b><span class="small muted">Visits</span></div><div class="card stat"><b>${done}</b><span class="small muted">Finished</span></div><div class="card stat" style="cursor:pointer" data-go="#/inbox"><b>${S.counts.messages + S.counts.requests + S.counts.touchups}</b><span class="small muted">Inbox items</span></div></div>
      ${visits.length ? visits.map(v => {
        const c = v.customers || {}, ca = areas.filter(a => a.customer_id === v.customer_id);
        const pri = (A.planPriorities(ca, v, c.cadence_days, CFG.prioritiesPerVisit)[0] || { areas: [] }).areas;
        const team = (v.team_ids || []).map(teamName).filter(Boolean).join(', ');
        const nextAct = { scheduled: ['on_the_way', 'On the way'], on_the_way: ['arrived', 'Arrived'] }[v.status];
        return `<div class="card"><div class="row between wrap"><div class="grow"><div class="row"><h2>${esc(fullName(c))}</h2>${statusPill(v.status)}</div>
            <p class="muted small" style="margin-top:2px">${esc(v.window_label)}${team ? ', ' + esc(team) : ''}</p>
            ${c.address ? `<a class="small" style="color:var(--blue)" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(c.address)}">${esc(c.address)}</a>` : ''}</div></div>
          ${pri.length ? `<p class="small" style="margin-top:10px"><span class="muted">Extra attention:</span> ${pri.map(a => esc(a.icon + ' ' + a.name)).join(', ')}</p>` : ''}
          ${v.client_request ? `<p class="small" style="margin-top:6px"><span class="muted">Client asked:</span> ${esc(v.client_request)}</p>` : ''}
          <div class="row wrap" style="margin-top:14px">${nextAct ? `<button type="button" class="btn sm" data-act="status" data-id="${v.id}" data-s="${nextAct[0]}">${nextAct[1]}</button>` : ''}
            ${!['finished', 'cancelled', 'skipped'].includes(v.status) ? `<button type="button" class="btn green sm" data-act="finish" data-id="${v.id}">Finish visit</button>` : ''}
            <button type="button" class="btn soft sm" data-go="#/c/${v.customer_id}/overview">Open home</button></div></div>`;
      }).join('') : `<div class="card empty">No visits on this day.</div>`}`);
    H.day = el => { const n = +el.dataset.n; S.day = n === 0 ? null : A.isoDate(A.addDays(d, n)); route(); };
    H.status = async el => { if (await run(() => setVisitStatus(el.dataset.id, el.dataset.s), el, el.dataset.s === 'on_the_way' ? 'Client sees: on the way' : 'Client sees: arrived')) route(); };
    H.finish = el => finishSheet(el.dataset.id, route);
  }
  async function setVisitStatus(id, s) {
    const patch = { status: s };
    if (s === 'on_the_way') patch.on_the_way_at = new Date().toISOString();
    if (s === 'arrived') patch.arrived_at = new Date().toISOString();
    await q(sb.from('visits').update(patch).eq('id', id));
  }

  // ---------- FINISH VISIT ----------
  async function finishSheet(visitId, after) {
    const v = await q(sb.from('visits').select('*').eq('id', visitId).single());
    const [c, areas, photos, st] = await Promise.all([
      q(sb.from('customers').select('id,first_name,last_name,price,cadence_days').eq('id', v.customer_id).single()),
      q(sb.from('care_areas').select('*').eq('customer_id', v.customer_id).eq('active', true).order('sort')),
      q(sb.from('visit_photos').select('*').eq('visit_id', visitId).order('sort')),
      getSettings(),
    ]);
    const auto = (A.planPriorities(areas, v, c.cadence_days, CFG.prioritiesPerVisit)[0] || { areas: [] }).areas.map(a => a.id);
    openSheet(`<h2>Finish visit</h2><p class="muted small">${esc(fullName(c))}, ${esc(A.long(A.parseDate(v.scheduled_date)))}</p>
      <h3>Extra attention given to</h3>
      <div class="chips" id="finAreas">${areas.map(a => `<button type="button" class="chip" data-act="fin-toggle" data-id="${a.id}" aria-pressed="${auto.includes(a.id)}">${esc(a.icon)} ${esc(a.name)}</button>`).join('')}</div>
      <h3>Photos for the client</h3><div class="photos" id="finPhotos">${photoGrid(photos)}</div>
      <div class="form">${fieldHTML({ k: 'team_note', label: 'Note from the team (client sees this)', type: 'textarea', full: true }, v.team_note)}
        ${fieldHTML({ k: 'amount', label: 'Amount charged', type: 'number', step: '0.01' }, v.amount ?? c.price)}
        ${fieldHTML({ k: 'checklist', label: 'What was done', type: 'lines', rows: 6 }, v.checklist && v.checklist.length ? v.checklist : st.default_checklist)}</div>
      <div class="sheet-actions"><button type="button" class="btn soft" data-act="sheet-cancel">Cancel</button><button type="button" class="btn green" data-act="fin-save">Finish visit</button></div>`);
    bindPhotoUpload(c.id, v.id, 'finPhotos');
    H['sheet-cancel'] = closeSheet;
    H['fin-toggle'] = el => el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true');
    H['fin-save'] = async btn => {
      const ids = [...document.querySelectorAll('#finAreas [aria-pressed="true"]')].map(x => x.dataset.id);
      const data = readFields([{ k: 'team_note', type: 'textarea' }, { k: 'amount', type: 'number' }, { k: 'checklist', type: 'lines' }]);
      let nextId = null;
      const ok = await run(async () => {
        await q(sb.from('visits').update({ team_note: data.team_note, amount: data.amount, checklist: data.checklist }).eq('id', v.id));
        nextId = await q(sb.rpc('admin_finish_visit', { p_visit_id: v.id, p_area_ids: ids }));
      }, btn);
      if (!ok) return;
      let msg = 'Visit finished. The client can see the report.';
      if (nextId) { try { const nv = await q(sb.from('visits').select('scheduled_date').eq('id', nextId).single()); msg += ` Next visit: ${A.long(A.parseDate(nv.scheduled_date))}.`; } catch (_) { } }
      toast(msg); closeSheet(); if (after) after();
    };
  }

  // ---------- photos ----------
  function photoGrid(photos) {
    return photos.map(p => `<figure><img src="${esc(p.url)}" alt="" loading="lazy"><button type="button" data-act="photo-del" data-id="${p.id}" data-path="${esc(p.path || '')}" aria-label="Remove photo">✕</button></figure>`).join('')
      + `<label class="upload">＋ Add photos<input type="file" accept="image/*" multiple hidden data-upload></label>`;
  }
  function bindPhotoUpload(customerId, visitId, gridId) {
    const grid = $(gridId);
    const rebind = () => {
      const input = grid.querySelector('[data-upload]');
      input.addEventListener('change', async () => {
        const files = [...input.files]; if (!files.length) return;
        const label = input.parentElement; label.firstChild.textContent = `Uploading ${files.length}…`; label.style.pointerEvents = 'none';
        let okCount = 0;
        for (const f of files) {
          const ok = await run(async () => {
            const blob = await A.compressImage(f);
            const path = `${customerId}/${visitId}/${uid()}.jpg`;
            const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
            if (up.error) throw up.error;
            const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
            await q(sb.from('visit_photos').insert({ visit_id: visitId, customer_id: customerId, url, path, sort: Date.now() % 2000000000 }));
          });
          if (ok) okCount++;
        }
        if (okCount) toast(`${okCount} photo${okCount > 1 ? 's' : ''} added`);
        const photos = await q(sb.from('visit_photos').select('*').eq('visit_id', visitId).order('sort')).catch(() => []);
        grid.innerHTML = photoGrid(photos); rebind();
      });
    };
    rebind();
    H['photo-del'] = async btn => {
      if (!confirm('Remove this photo?')) return;
      if (await run(async () => {
        if (btn.dataset.path) await sb.storage.from(BUCKET).remove([btn.dataset.path]);
        await q(sb.from('visit_photos').delete().eq('id', btn.dataset.id));
      }, btn, 'Photo removed')) btn.closest('figure').remove();
    };
  }

  // ---------- CUSTOMERS ----------
  async function viewCustomers() {
    const [cs, nv] = await Promise.all([
      q(sb.from('customers').select('id,first_name,last_name,address,status,link_active').order('first_name')),
      q(sb.from('visits').select('customer_id,scheduled_date').in('status', ['scheduled', 'on_the_way', 'arrived']).order('scheduled_date')),
    ]);
    const next = {}; nv.forEach(v => { if (!next[v.customer_id]) next[v.customer_id] = v.scheduled_date; });
    const list = () => {
      const s = S.search.toLowerCase();
      const rows = cs.filter(c => !s || (fullName(c) + ' ' + (c.address || '')).toLowerCase().includes(s));
      return rows.length ? rows.map(c => `<button type="button" class="item" data-go="#/c/${c.id}/overview"><div class="ico">🏡</div><div class="grow"><div class="title">${esc(fullName(c))}</div><div class="small muted">${next[c.id] ? 'Next visit ' + esc(A.short(A.parseDate(next[c.id]))) : 'No visit scheduled'}${c.address ? ', ' + esc(c.address) : ''}</div></div>${c.link_active ? '' : '<span class="pill gray">Link off</span>'}${custPill(c.status)}</button>`).join('') : `<div class="empty">${cs.length ? 'No matches.' : 'No homes yet. Add your first client.'}</div>`;
    };
    setContent(`<div class="head"><div><h1>Homes</h1><p class="muted">${cs.length} client${cs.length === 1 ? '' : 's'}</p></div><button type="button" class="btn" data-act="new-cust">New client</button></div>
      <input type="search" id="search" placeholder="Search by name or address" value="${esc(S.search)}" style="margin-bottom:14px">
      <div class="list" id="custList">${list()}</div>`);
    $('search').addEventListener('input', e => { S.search = e.target.value; $('custList').innerHTML = list(); });
    H['new-cust'] = () => editSheet({
      title: 'New client', saveLabel: 'Create client',
      sub: 'Creates their home with the standard rotation and key spots. You can change everything after.',
      fields: [{ k: 'first_name', label: 'First name', req: true }, { k: 'last_name', label: 'Last name' }, { k: 'phone', label: 'Mobile', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' },
        { k: 'address', label: 'Address', full: true }, { k: 'price', label: 'Price per visit', type: 'number', def: 275 }, { k: 'cadence_days', label: 'Visit every', type: 'select', options: [['7', 'Week'], ['14', '2 weeks'], ['21', '3 weeks'], ['28', '4 weeks']], def: '14' },
        { k: 'first_visit_date', label: 'First visit date', type: 'date' }, { k: 'default_window', label: 'Arrival window', list: 'windows', def: '9:00 to 9:30 AM' }],
      extra: WINDOWS,
      onSave: async data => { const id = await q(sb.rpc('admin_create_customer', { p_data: data })); setTimeout(() => go(`#/c/${id}/overview`), 50); },
    });
  }

  // ---------- CUSTOMER ----------
  async function loadCustomer(id) {
    const [c, ct, visits, areas, surfaces, spots, notes, touchups, messages, requests] = await Promise.all([
      q(sb.from('customers').select('*').eq('id', id).single()),
      q(sb.from('customer_team').select('member_id').eq('customer_id', id)),
      q(sb.from('visits').select('*').eq('customer_id', id).order('scheduled_date', { ascending: false })),
      q(sb.from('care_areas').select('*').eq('customer_id', id).order('sort').order('name')),
      q(sb.from('surfaces').select('*').eq('customer_id', id).order('room').order('sort')),
      q(sb.from('key_spots').select('*').eq('customer_id', id).order('sort')),
      q(sb.from('team_notes').select('*').eq('customer_id', id).order('created_at', { ascending: false })),
      q(sb.from('touchups').select('*').eq('customer_id', id).order('created_at', { ascending: false })),
      q(sb.from('messages').select('*').eq('customer_id', id).order('created_at').limit(300)),
      q(sb.from('requests').select('*').eq('customer_id', id).order('created_at', { ascending: false })),
    ]);
    await getTeam();
    S.cust = { c, team: ct.map(x => x.member_id), visits, areas, surfaces, spots, notes, touchups, messages, requests };
    return S.cust;
  }
  async function viewCustomer(id) {
    const X = await loadCustomer(id), c = X.c;
    const unread = X.messages.filter(m => m.sender === 'client' && !m.read_by_admin).length;
    const openReq = X.requests.filter(r => r.status === 'open').length + X.touchups.filter(t => t.status === 'open').length;
    const TABS = [['overview', 'Overview'], ['visits', 'Visits'], ['priorities', 'Priorities'], ['guide', 'Care guide'], ['notes', 'Notes'], ['messages', 'Messages' + (unread ? ` (${unread})` : '')], ['requests', 'Requests' + (openReq ? ` (${openReq})` : '')]];
    setContent(`<button type="button" class="btn soft sm" data-go="#/customers" style="margin-bottom:12px">All homes</button>
      <div class="card"><div class="row between wrap"><div><h1 style="font-size:26px">${esc(fullName(c))}</h1><p class="muted small">${esc(c.address || 'No address yet')}</p></div><div class="row">${custPill(c.status)}${c.link_active ? '' : '<span class="pill gray">Link off</span>'}</div></div>
        <div class="linkbox"><code>${c.link_active ? esc(linkFor(c)) : 'Link is turned off'}</code>${c.link_active ? `<button type="button" class="btn sm" data-act="copy-link">Copy</button><a class="btn soft sm" href="${esc(linkFor(c))}" target="_blank" rel="noopener">Open</a>` : ''}</div>
        <div class="row wrap" style="margin-top:10px">${c.link_active && c.phone ? `<a class="btn soft sm" href="sms:${esc(c.phone.replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(`Hi ${c.first_name}, here's your Alora home: ${linkFor(c)}`)}">Text link</a>` : ''}
          <button type="button" class="btn soft sm" data-act="new-link">New link</button><button type="button" class="btn soft sm" data-act="toggle-link">${c.link_active ? 'Turn link off' : 'Turn link on'}</button></div></div>
      <div class="tabs">${TABS.map(([k, l]) => `<button type="button" data-go="#/c/${c.id}/${k}" aria-pressed="${S.ctab === k}">${l}</button>`).join('')}</div>
      <div id="ctab"></div>`);
    H['copy-link'] = async () => { try { await navigator.clipboard.writeText(linkFor(c)); toast('Link copied'); } catch (_) { prompt('Copy this link', linkFor(c)); } };
    H['new-link'] = async btn => { if (!confirm('Create a new link? The current link will stop working right away.')) return; if (await run(() => q(sb.rpc('admin_new_link', { p_customer_id: c.id })), btn, 'New link created. Send it to the client.')) route(); };
    H['toggle-link'] = async btn => { if (await run(() => q(sb.from('customers').update({ link_active: !c.link_active }).eq('id', c.id)), btn, c.link_active ? 'Link turned off' : 'Link turned on')) route(); };
    const T = { overview: tabOverview, visits: tabVisits, priorities: tabPriorities, guide: tabGuide, notes: tabNotes, messages: tabMessages, requests: tabRequests }[S.ctab] || tabOverview;
    await T(X);
  }
  const ctab = html => { $('ctab').innerHTML = html; };
  const reloadTab = () => route();

  const PROFILE_FIELDS = [
    { k: 'first_name', label: 'First name', req: true }, { k: 'last_name', label: 'Last name' },
    { k: 'phone', label: 'Mobile', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' },
    { k: 'address', label: 'Address', full: true }, { k: 'home_name', label: 'Home name' },
    { k: 'background', label: 'Background', type: 'select', options: [['cloud', 'Cloud'], ['sky', 'Sky'], ['lagoon', 'Lagoon'], ['linen', 'Linen'], ['midnight', 'Midnight'], ['photo', 'Their home photo']] },
    { k: 'sqft', label: 'Square feet', type: 'number' }, { k: 'year_built', label: 'Year built', type: 'number' },
    { k: 'beds', label: 'Bedrooms', type: 'number', step: '0.5' }, { k: 'baths', label: 'Bathrooms', type: 'number', step: '0.5' },
    { k: 'household', label: 'Household' }, { k: 'pets', label: 'Pets' },
    { k: 'good_to_know', label: 'Good to know (client can edit)', type: 'textarea', full: true },
    { k: 'scent', label: 'Scent', type: 'select', options: ['None', 'Eucalyptus', 'Lavender', 'Citrus'] }, { k: 'linens', label: 'Linens', type: 'select', options: ['Hotel fold', 'Tucked', 'Leave as is'] },
    { k: 'sensitivities', label: 'Allergies and sensitivities' }, { k: 'leave_alone', label: 'Please leave alone' },
    { k: 'entry_notes', label: 'Entry notes, codes, alarm (ADMIN ONLY)', type: 'textarea', full: true, hint: 'Never shown to the client.' },
    { k: 'admin_notes', label: 'Private notes (ADMIN ONLY)', type: 'textarea', full: true },
    { k: 'plan_name', label: 'Plan name' }, { k: 'cadence_days', label: 'Visit every', type: 'select', options: [['7', 'Week'], ['14', '2 weeks'], ['21', '3 weeks'], ['28', '4 weeks']] },
    { k: 'price', label: 'Price per visit', type: 'number', step: '0.01', req: true }, { k: 'card_last4', label: 'Card last 4 digits' },
    { k: 'default_window', label: 'Usual arrival window', list: 'windows' },
    { k: 'status', label: 'Membership status', type: 'select', options: [['active', 'Active'], ['paused', 'Paused'], ['cancelled', 'Cancelled']] },
  ];
  async function tabOverview(X) {
    const c = X.c, team = await getTeam();
    ctab(`<div class="card"><h2>Home photo</h2><p class="muted small" style="margin:4px 0 10px">Shown at the top of their app. Leave empty to use the default.</p>
        <div class="row wrap">${c.home_photo_url ? `<img src="${esc(c.home_photo_url)}" alt="" style="width:120px;height:90px;object-fit:cover;border-radius:14px">` : ''}
        <label class="btn soft sm">Upload photo<input type="file" accept="image/*" hidden id="homePhotoIn"></label>${c.home_photo_url ? '<button type="button" class="btn soft sm" data-act="home-photo-remove">Remove</button>' : ''}</div></div>
      <div class="card"><h2>Team</h2><p class="muted small" style="margin:4px 0 10px">Default team for this home. You can change it per visit.</p>
        <div class="chips" id="custTeam">${team.length ? team.filter(t => t.active || X.team.includes(t.id)).map(t => `<button type="button" class="chip" data-act="ct-toggle" data-id="${t.id}" aria-pressed="${X.team.includes(t.id)}"><span class="dot" style="background:${esc(t.color)};display:inline-block;width:8px;height:8px;margin-right:6px"></span>${esc(t.name)}</button>`).join('') : '<span class="muted small">Add team members in Team first.</span>'}</div></div>
      <div class="card"><h2>Details</h2><div class="form">${PROFILE_FIELDS.map(f => fieldHTML(f, f.k === 'cadence_days' ? String(c[f.k]) : c[f.k])).join('')}</div>${WINDOWS}
        <button type="button" class="btn block" style="margin-top:18px" data-act="save-profile">Save details</button></div>
      <div class="card"><h2>Danger zone</h2><p class="muted small" style="margin:4px 0 12px">Deleting removes this home, its visits, photos and messages for good.</p><button type="button" class="btn danger" data-act="delete-cust">Delete this client</button></div>`);
    H['save-profile'] = async btn => {
      let d; try { d = readFields(PROFILE_FIELDS); } catch (e) { toast(e.message, true); return; }
      d.cadence_days = Number(d.cadence_days);
      if (await run(() => q(sb.from('customers').update(d).eq('id', c.id)), btn, 'Saved')) route();
    };
    H['ct-toggle'] = async el => {
      const on = el.getAttribute('aria-pressed') === 'true', mid = el.dataset.id;
      const ok = await run(() => on ? q(sb.from('customer_team').delete().eq('customer_id', c.id).eq('member_id', mid)) : q(sb.from('customer_team').insert({ customer_id: c.id, member_id: mid })), el);
      if (ok) { el.setAttribute('aria-pressed', !on); on ? X.team.splice(X.team.indexOf(mid), 1) : X.team.push(mid); }
    };
    $('homePhotoIn').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      if (await run(async () => {
        const blob = await A.compressImage(f, 2000);
        const path = `${c.id}/home/${uid()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' }); if (up.error) throw up.error;
        await q(sb.from('customers').update({ home_photo_url: sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl }).eq('id', c.id));
      }, null, 'Home photo updated')) route();
    });
    H['home-photo-remove'] = async btn => { if (await run(() => q(sb.from('customers').update({ home_photo_url: null, background: c.background === 'photo' ? 'cloud' : c.background }).eq('id', c.id)), btn, 'Photo removed')) route(); };
    H['delete-cust'] = async btn => {
      const typed = prompt(`Type ${c.first_name} to delete this client for good.`); if (typed == null) return;
      if (typed.trim().toLowerCase() !== c.first_name.toLowerCase()) { toast('Name didn\'t match. Nothing was deleted.', true); return; }
      if (await run(async () => {
        try { const files = await collectFiles(c.id); if (files.length) await sb.storage.from(BUCKET).remove(files); } catch (_) { }
        await q(sb.from('customers').delete().eq('id', c.id));
      }, btn, 'Client deleted')) go('#/customers');
    };
  }
  async function collectFiles(prefix) {
    const out = []; const { data: top } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000 });
    for (const item of top || []) {
      if (item.id) out.push(`${prefix}/${item.name}`);
      else { const { data: inner } = await sb.storage.from(BUCKET).list(`${prefix}/${item.name}`, { limit: 1000 }); (inner || []).forEach(f => out.push(`${prefix}/${item.name}/${f.name}`)); }
    }
    return out;
  }

  // Visits tab
  async function tabVisits(X) {
    const up = X.visits.filter(v => ['scheduled', 'on_the_way', 'arrived'].includes(v.status)).reverse();
    const past = X.visits.filter(v => !['scheduled', 'on_the_way', 'arrived'].includes(v.status));
    const row = v => `<button type="button" class="item" data-act="visit" data-id="${v.id}"><div class="grow"><div class="title">${esc(A.long(A.parseDate(v.scheduled_date)))}</div><div class="small muted">${esc(v.window_label)}${v.rating ? `, rated ${v.rating}★` : ''}${v.tip ? `, tip ${A.money(v.tip)}` : ''}</div></div>${statusPill(v.status)}</button>`;
    ctab(`<div class="row between" style="margin-bottom:10px"><h2>Upcoming</h2><button type="button" class="btn sm" data-act="visit-new">Schedule a visit</button></div>
      <div class="list">${up.length ? up.map(row).join('') : '<div class="empty">No upcoming visit. Schedule one so the client sees their next date.</div>'}</div>
      <h2 style="margin:22px 0 10px">Past</h2><div class="list">${past.length ? past.map(row).join('') : '<div class="empty">No past visits yet.</div>'}</div>`);
    H.visit = el => visitSheet(X, X.visits.find(v => v.id === el.dataset.id));
    H['visit-new'] = () => {
      const last = X.visits.find(v => v.status === 'finished') || X.visits[0];
      const base = last ? A.addDays(A.parseDate(last.scheduled_date), X.c.cadence_days) : A.addDays(A.today(), 1);
      visitSheet(X, { customer_id: X.c.id, scheduled_date: A.isoDate(base < A.today() ? A.addDays(A.today(), 1) : base), window_label: X.c.default_window, status: 'scheduled', team_ids: X.team, priorities: [] });
    };
  }
  function visitSheet(X, v) {
    const isNew = !v.id;
    const fields = [{ k: 'scheduled_date', label: 'Date', type: 'date', req: true }, { k: 'window_label', label: 'Arrival window', list: 'windows', req: true },
      { k: 'status', label: 'Status', type: 'select', options: [['scheduled', 'Scheduled'], ['on_the_way', 'On the way'], ['arrived', 'Arrived'], ['finished', 'Finished'], ['skipped', 'Skipped'], ['cancelled', 'Cancelled']] },
      { k: 'amount', label: 'Amount charged', type: 'number', step: '0.01' }, { k: 'tip', label: 'Tip', type: 'number', step: '0.01' },
      { k: 'team_note', label: 'Note from the team (client sees this)', type: 'textarea', full: true }, { k: 'checklist', label: 'What was done (client sees this)', type: 'lines', rows: 5 }];
    const pinned = new Set(v.priorities || []);
    const extra = `${WINDOWS}<h3>Team for this visit</h3><div class="chips" id="vTeam">${(S.team || []).filter(t => t.active || (v.team_ids || []).includes(t.id)).map(t => `<button type="button" class="chip" data-act="chip" data-id="${t.id}" aria-pressed="${(v.team_ids || []).includes(t.id)}">${esc(t.name)}</button>`).join('') || '<span class="muted small">No team members yet.</span>'}</div>
      <h3>Priorities (extra attention)</h3><p class="small muted" style="margin-bottom:8px">Leave all off to use the automatic rotation.</p>
      <div class="chips" id="vPri">${X.areas.filter(a => a.active).map(a => `<button type="button" class="chip" data-act="chip" data-id="${a.id}" aria-pressed="${pinned.has(a.id)}">${esc(a.icon)} ${esc(a.name)}</button>`).join('')}</div>
      ${v.client_request ? `<p class="small" style="margin-top:10px"><span class="muted">Client asked:</span> ${esc(v.client_request)}</p>` : ''}
      ${v.rating ? `<p class="small" style="margin-top:6px"><span class="muted">Client rating:</span> ${'★'.repeat(v.rating)}</p>` : ''}
      ${isNew ? '' : `<h3>Photos</h3><div class="photos" id="vPhotos"><div class="muted small">Loading…</div></div>`}
      ${!isNew && !['finished', 'cancelled', 'skipped'].includes(v.status) ? `<button type="button" class="btn green block" style="margin-top:16px" data-act="v-finish">Finish this visit</button>` : ''}`;
    editSheet({
      title: isNew ? 'Schedule a visit' : 'Visit', sub: esc(fullName(X.c)), fields, values: v, extra,
      onSave: async d => {
        d.team_ids = [...document.querySelectorAll('#vTeam [aria-pressed="true"]')].map(x => x.dataset.id);
        d.priorities = [...document.querySelectorAll('#vPri [aria-pressed="true"]')].map(x => x.dataset.id);
        d.checklist = d.checklist || [];
        if (d.status === 'finished' && v.status !== 'finished') { d.finished_at = new Date().toISOString(); }
        if (isNew) await q(sb.from('visits').insert(Object.assign({ customer_id: X.c.id }, d)));
        else await q(sb.from('visits').update(d).eq('id', v.id));
        setTimeout(reloadTab, 50);
      },
      onDelete: isNew ? null : async () => { await q(sb.from('visits').delete().eq('id', v.id)); setTimeout(reloadTab, 50); },
    });
    H.chip = el => el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true');
    H['v-finish'] = () => finishSheet(v.id, reloadTab);
    if (!isNew) q(sb.from('visit_photos').select('*').eq('visit_id', v.id).order('sort')).then(p => { const g = $('vPhotos'); if (g) { g.innerHTML = photoGrid(p); bindPhotoUpload(X.c.id, v.id, 'vPhotos'); } }).catch(() => { const g = $('vPhotos'); if (g) g.innerHTML = '<span class="muted small">Couldn\'t load photos.</span>'; });
  }

  // Priorities tab
  async function tabPriorities(X) {
    const nv = [...X.visits].reverse().find(v => ['scheduled', 'on_the_way', 'arrived'].includes(v.status));
    const active = X.areas.filter(a => a.active);
    const groups = A.planPriorities(active, nv, X.c.cadence_days, CFG.prioritiesPerVisit).slice(0, 4);
    ctab(`<div class="card"><h2>What the client sees</h2><p class="muted small" style="margin:4px 0 10px">${nv ? (nv.priorities && nv.priorities.length ? 'Next visit uses priorities picked by you or the client.' : 'Next visit uses the automatic rotation (areas that waited longest).') : 'Schedule a visit to show the rotation.'}</p>
        ${groups.map((g, i) => `<p style="margin-top:6px"><strong>${i === 0 ? 'Next visit' : esc(A.short(g.date))}:</strong> ${g.areas.map(a => esc(a.name)).join(', ')}</p>`).join('')}</div>
      <div class="row between" style="margin:20px 0 10px"><h2>Rotation areas</h2><button type="button" class="btn sm" data-act="area-new">Add area</button></div>
      <div class="list">${X.areas.length ? X.areas.map(a => `<button type="button" class="item" data-act="area" data-id="${a.id}"><div class="ico">${esc(a.icon)}</div><div class="grow"><div class="title">${esc(a.name)}</div><div class="small muted">Every ${a.interval_days} days, last ${a.last_done ? esc(A.short(A.parseDate(a.last_done))) : 'never'}</div></div>${a.active ? '' : '<span class="pill gray">Off</span>'}</button>`).join('') : '<div class="empty">No areas yet.</div>'}</div>`);
    const F = [{ k: 'icon', label: 'Emoji' }, { k: 'name', label: 'Area name', req: true }, { k: 'interval_days', label: 'Every how many days', type: 'number', req: true }, { k: 'last_done', label: 'Last extra attention', type: 'date' }, { k: 'sort', label: 'Order', type: 'number' }, { k: 'active', label: 'In the rotation', type: 'checkbox' }];
    H['area-new'] = () => editSheet({ title: 'New area', fields: F, values: { icon: '✨', interval_days: 60, sort: X.areas.length + 1, active: true }, onSave: async d => { d.icon = d.icon || '✨'; await q(sb.from('care_areas').insert(Object.assign({ customer_id: X.c.id }, d))); setTimeout(reloadTab, 50); } });
    H.area = el => { const a = X.areas.find(x => x.id === el.dataset.id); editSheet({ title: 'Edit area', fields: F, values: a, onSave: async d => { d.icon = d.icon || '✨'; await q(sb.from('care_areas').update(d).eq('id', a.id)); setTimeout(reloadTab, 50); }, onDelete: async () => { await q(sb.from('care_areas').delete().eq('id', a.id)); setTimeout(reloadTab, 50); } }); };
  }

  // Care guide tab
  async function tabGuide(X) {
    const rooms = {}; X.surfaces.forEach(s => (rooms[s.room] = rooms[s.room] || []).push(s));
    ctab(`<div class="row between" style="margin-bottom:10px"><h2>Rooms and surfaces</h2><button type="button" class="btn sm" data-act="surf-new">Add surface</button></div>
      ${Object.keys(rooms).length ? Object.entries(rooms).map(([r, items]) => `<div class="list" style="margin-bottom:12px"><div class="item"><div class="title">${esc(r)}</div></div>${items.map(s => `<button type="button" class="item" data-act="surf" data-id="${s.id}"><div class="grow"><div>${esc(s.name)}</div><div class="small muted">${esc(s.care_note || '')}</div></div></button>`).join('')}</div>`).join('') : '<div class="card empty">No surfaces yet. Add them at the first visit.</div>'}
      <div class="row between" style="margin:22px 0 10px"><h2>Key spots</h2><button type="button" class="btn sm" data-act="spot-new">Add spot</button></div>
      <div class="list">${X.spots.length ? X.spots.map(k => `<button type="button" class="item" data-act="spot" data-id="${k.id}"><div class="ico">${esc(k.icon)}</div><div class="grow"><div class="title">${esc(k.name)}</div><div class="small muted">${esc(k.location || 'Location not recorded')}</div></div></button>`).join('') : '<div class="empty">No key spots yet.</div>'}</div>`);
    const roomList = `<datalist id="rooms">${['Kitchen', 'Primary bath', 'Guest bath', 'Living room', 'Dining room', 'Foyer', 'Primary bedroom', 'Bedrooms', 'Office', 'Laundry', ...Object.keys(rooms)].filter((x, i, arr) => arr.indexOf(x) === i).map(r => `<option value="${esc(r)}">`).join('')}</datalist>`;
    const SF = [{ k: 'room', label: 'Room', req: true, list: 'rooms' }, { k: 'name', label: 'Surface or item', req: true }, { k: 'care_note', label: 'How to care for it', type: 'textarea', full: true }, { k: 'sort', label: 'Order', type: 'number' }];
    const KF = [{ k: 'icon', label: 'Emoji' }, { k: 'name', label: 'What', req: true }, { k: 'location', label: 'Where it is', full: true }, { k: 'sort', label: 'Order', type: 'number' }];
    H['surf-new'] = () => editSheet({ title: 'New surface', fields: SF, values: { sort: X.surfaces.length + 1 }, extra: roomList, onSave: async d => { await q(sb.from('surfaces').insert(Object.assign({ customer_id: X.c.id }, d))); setTimeout(reloadTab, 50); } });
    H.surf = el => { const s = X.surfaces.find(x => x.id === el.dataset.id); editSheet({ title: 'Edit surface', fields: SF, values: s, extra: roomList, onSave: async d => { await q(sb.from('surfaces').update(d).eq('id', s.id)); setTimeout(reloadTab, 50); }, onDelete: async () => { await q(sb.from('surfaces').delete().eq('id', s.id)); setTimeout(reloadTab, 50); } }); };
    H['spot-new'] = () => editSheet({ title: 'New key spot', fields: KF, values: { icon: '📍', sort: X.spots.length + 1 }, onSave: async d => { d.icon = d.icon || '📍'; await q(sb.from('key_spots').insert(Object.assign({ customer_id: X.c.id }, d))); setTimeout(reloadTab, 50); } });
    H.spot = el => { const k = X.spots.find(x => x.id === el.dataset.id); editSheet({ title: 'Edit key spot', fields: KF, values: k, onSave: async d => { d.icon = d.icon || '📍'; await q(sb.from('key_spots').update(d).eq('id', k.id)); setTimeout(reloadTab, 50); }, onDelete: async () => { await q(sb.from('key_spots').delete().eq('id', k.id)); setTimeout(reloadTab, 50); } }); };
  }

  // Notes tab
  async function tabNotes(X) {
    ctab(`<div class="row between" style="margin-bottom:10px"><h2>Notes from the team</h2><button type="button" class="btn sm" data-act="note-new">Add note</button></div>
      <p class="small muted" style="margin-bottom:10px">The client sees these as courtesy notes, not an inspection.</p>
      <div class="list">${X.notes.length ? X.notes.map(n => `<button type="button" class="item" data-act="note" data-id="${n.id}"><div class="grow"><div class="title">${esc(n.note)}</div><div class="small muted">${esc(A.short(new Date(n.created_at)))}</div></div>${n.resolved ? '<span class="pill green">Taken care of</span>' : '<span class="pill amber">Open</span>'}</button>`).join('') : '<div class="empty">No notes.</div>'}</div>
      <h2 style="margin:22px 0 10px">Touch-up requests</h2>
      <div class="list">${X.touchups.length ? X.touchups.map(t => `<div class="item"><div class="grow"><div class="title">${esc([t.areas, t.note].filter(Boolean).join(': '))}</div><div class="small muted">${esc(A.short(new Date(t.created_at)))}</div></div>
        <select data-tu="${t.id}" style="width:auto">${[['open', 'Open'], ['scheduled', 'Scheduled'], ['done', 'Done']].map(([k, l]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('') : '<div class="empty">No touch-up requests.</div>'}</div>`);
    document.querySelectorAll('[data-tu]').forEach(s => s.addEventListener('change', async () => { if (await run(() => q(sb.from('touchups').update({ status: s.value }).eq('id', s.dataset.tu)), null, 'Updated')) refreshCounts(); }));
    const F = [{ k: 'note', label: 'Note', type: 'textarea', req: true, full: true }, { k: 'resolved', label: 'Taken care of', type: 'checkbox' }];
    H['note-new'] = () => editSheet({ title: 'New note', fields: F, values: {}, onSave: async d => { await q(sb.from('team_notes').insert(Object.assign({ customer_id: X.c.id }, d))); setTimeout(reloadTab, 50); } });
    H.note = el => { const n = X.notes.find(x => x.id === el.dataset.id); editSheet({ title: 'Edit note', fields: F, values: n, onSave: async d => { await q(sb.from('team_notes').update(d).eq('id', n.id)); setTimeout(reloadTab, 50); }, onDelete: async () => { await q(sb.from('team_notes').delete().eq('id', n.id)); setTimeout(reloadTab, 50); } }); };
  }

  // Messages tab
  async function tabMessages(X) {
    ctab(`<div class="card"><div class="thread" id="thread">${X.messages.length ? X.messages.map(m => `<div class="msg ${m.sender}">${esc(m.body)}<time>${esc(A.short(new Date(m.created_at)))}, ${esc(A.time(m.created_at))}</time></div>`).join('') : '<div class="empty">No messages yet. Say hi.</div>'}</div>
      <div class="row" style="margin-top:12px;align-items:flex-end"><textarea id="reply" rows="2" maxlength="2000" placeholder="Reply to ${esc(X.c.first_name)}" style="flex:1"></textarea><button type="button" class="btn" data-act="send">Send</button></div></div>`);
    const th = $('thread'); th.scrollTop = th.scrollHeight;
    if (X.messages.some(m => m.sender === 'client' && !m.read_by_admin)) {
      sb.from('messages').update({ read_by_admin: true }).eq('customer_id', X.c.id).eq('sender', 'client').eq('read_by_admin', false).then(() => refreshCounts());
    }
    H.send = async btn => { const body = $('reply').value.trim(); if (!body) return; if (await run(() => q(sb.from('messages').insert({ customer_id: X.c.id, sender: 'alora', body })), btn, 'Sent')) reloadTab(); };
  }

  // Requests tab
  const REQ_LABEL = { reschedule: 'Change date', skip: 'Skip next visit', pause: 'Pause', resume: 'Resume', cancel: 'Cancel membership', detail_change: 'Change request' };
  function requestRow(r, withName) {
    return `<div class="item"><div class="grow"><div class="title">${withName ? esc(withName) + ': ' : ''}${REQ_LABEL[r.kind] || r.kind}</div><div class="small muted">${esc(r.details || '')}${r.details ? ', ' : ''}${esc(A.short(new Date(r.created_at)))}</div></div>
      ${r.status === 'open' ? `<button type="button" class="btn sm" data-act="req-done" data-id="${r.id}">Done</button><button type="button" class="btn soft sm" data-act="req-decline" data-id="${r.id}">Decline</button>` : `<span class="pill ${r.status === 'done' ? 'green' : 'gray'}">${r.status === 'done' ? 'Done' : 'Declined'}</span>`}</div>`;
  }
  function bindRequestButtons(after) {
    const set = (status) => async el => { if (await run(() => q(sb.from('requests').update({ status, resolved_at: new Date().toISOString() }).eq('id', el.dataset.id)), el, status === 'done' ? 'Marked done' : 'Declined')) { refreshCounts(); after(); } };
    H['req-done'] = set('done'); H['req-decline'] = set('declined');
  }
  async function tabRequests(X) {
    ctab(`<p class="small muted" style="margin-bottom:10px">Requests don't change anything by themselves. Make the change (for example, edit the visit date or membership status), then mark the request done.</p>
      <div class="list">${X.requests.length ? X.requests.map(r => requestRow(r)).join('') : '<div class="empty">No requests.</div>'}</div>
      ${X.touchups.filter(t => t.status === 'open').length ? `<p class="small muted" style="margin-top:12px">There are open touch-up requests in the Notes tab.</p>` : ''}`);
    bindRequestButtons(reloadTab);
  }

  // ---------- INBOX ----------
  async function viewInbox() {
    const [msgs, reqs, tus] = await Promise.all([
      q(sb.from('messages').select('customer_id,body,created_at,customers(first_name,last_name)').eq('sender', 'client').eq('read_by_admin', false).order('created_at', { ascending: false }).limit(200)),
      q(sb.from('requests').select('*, customers(first_name,last_name)').eq('status', 'open').order('created_at')),
      q(sb.from('touchups').select('*, customers(first_name,last_name)').eq('status', 'open').order('created_at')),
    ]);
    const byCust = {}; msgs.forEach(m => { if (!byCust[m.customer_id]) byCust[m.customer_id] = { m, n: 0 }; byCust[m.customer_id].n++; });
    setContent(`<div class="head"><h1>Inbox</h1></div>
      <h2 style="margin-bottom:10px">Unread messages</h2>
      <div class="list">${Object.keys(byCust).length ? Object.entries(byCust).map(([cid, x]) => `<button type="button" class="item" data-go="#/c/${cid}/messages"><div class="grow"><div class="title">${esc(fullName(x.m.customers || {}))}${x.n > 1 ? ` (${x.n})` : ''}</div><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.m.body)}</div></div><span class="small muted">${esc(A.short(new Date(x.m.created_at)))}</span></button>`).join('') : '<div class="empty">All caught up.</div>'}</div>
      <h2 style="margin:22px 0 10px">Requests</h2>
      <div class="list">${reqs.length ? reqs.map(r => requestRow(r, fullName(r.customers || {}))).join('') : '<div class="empty">No open requests.</div>'}</div>
      <h2 style="margin:22px 0 10px">Touch-ups</h2>
      <div class="list">${tus.length ? tus.map(t => `<button type="button" class="item" data-go="#/c/${t.customer_id}/notes"><div class="grow"><div class="title">${esc(fullName(t.customers || {}))}</div><div class="small muted">${esc([t.areas, t.note].filter(Boolean).join(': '))}</div></div><span class="pill amber">Open</span></button>`).join('') : '<div class="empty">No open touch-ups.</div>'}</div>`);
    bindRequestButtons(route);
    refreshCounts();
  }

  // ---------- TEAM ----------
  async function viewTeam() {
    const team = await getTeam(true);
    setContent(`<div class="head"><div><h1>Team</h1><p class="muted">Clients see first names and colors.</p></div><button type="button" class="btn" data-act="tm-new">Add member</button></div>
      <div class="list">${team.length ? team.map(t => `<button type="button" class="item" data-act="tm" data-id="${t.id}"><span class="dot" style="background:${esc(t.color)};width:14px;height:14px"></span><div class="grow"><div class="title">${esc(t.name)}</div><div class="small muted">${esc(t.phone || '')}</div></div>${t.active ? '' : '<span class="pill gray">Inactive</span>'}</button>`).join('') : '<div class="empty">No team members yet.</div>'}</div>`);
    const F = [{ k: 'name', label: 'First name', req: true }, { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'color', label: 'Color', type: 'color' }, { k: 'active', label: 'Active', type: 'checkbox' }];
    H['tm-new'] = () => editSheet({ title: 'New team member', fields: F, values: { color: '#0380F4', active: true }, onSave: async d => { await q(sb.from('team_members').insert(d)); setTimeout(route, 50); } });
    H.tm = el => { const t = team.find(x => x.id === el.dataset.id); editSheet({ title: 'Edit team member', fields: F, values: t, onSave: async d => { await q(sb.from('team_members').update(d).eq('id', t.id)); setTimeout(route, 50); }, onDelete: async () => { await q(sb.from('team_members').delete().eq('id', t.id)); setTimeout(route, 50); } }); };
  }

  // ---------- SETTINGS ----------
  async function viewSettings() {
    const s = await getSettings(true);
    const F = [{ k: 'company_name', label: 'Company name', req: true }, { k: 'support_phone', label: 'Support phone', type: 'tel' },
      { k: 'google_review_url', label: 'Google review link', full: true, placeholder: 'https://g.page/r/...' },
      { k: 'referral_offer', label: 'Referral offer (shown in Visits)', type: 'textarea', full: true }, { k: 'referral_url', label: 'Referral link', full: true, placeholder: 'https://alora...' },
      { k: 'default_checklist', label: 'Standard visit checklist', type: 'lines', rows: 7 }];
    setContent(`<div class="head"><h1>Settings</h1></div>
      <div class="card"><div class="form">${F.map(f => fieldHTML(f, s[f.k])).join('')}</div><button type="button" class="btn block" style="margin-top:18px" data-act="save-settings">Save settings</button></div>
      <div class="card"><h2>Account</h2><p class="muted small" style="margin:4px 0 12px">Signed in as ${esc(S.user && S.user.email)}</p><button type="button" class="btn soft" data-act="signout">Sign out</button></div>`);
    H['save-settings'] = async btn => { let d; try { d = readFields(F); } catch (e) { toast(e.message, true); return; } d.default_checklist = d.default_checklist || []; d.updated_at = new Date().toISOString(); if (await run(() => q(sb.from('app_settings').update(d).eq('id', 1)), btn, 'Settings saved')) getSettings(true); };
  }

  // ---------- boot ----------
  (async () => {
    $('root').innerHTML = '<div class="loading">Loading…</div>';
    if (/type=recovery/.test(location.hash)) return; // handled by PASSWORD_RECOVERY event
    try { const { data } = await sb.auth.getSession(); if (data.session) await afterSignIn(); else renderLogin(); }
    catch (e) { renderLogin(errMsg(e)); }
  })();
})();
