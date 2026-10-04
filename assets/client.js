/* ===== Alora client app ===== */
(function () {
  'use strict';
  const A = window.Alora, CFG = window.ALORA_CONFIG, esc = A.esc;
  const $ = id => document.getElementById(id);

  // ---------- link token ----------
  const token = (location.pathname.match(/\/h\/([A-Za-z0-9_-]{16,64})\/?$/) || [])[1]
    || new URLSearchParams(location.search).get('t') || '';
  const CACHE_KEY = 'alora:home:' + token;

  // ---------- state ----------
  const S = { data: null, tab: 'home', seg: 'home', offline: false, loading: true, fatal: null, previewBg: null };

  // ---------- network ----------
  const KNOWN = new Set(['invalid_link', 'visit_locked', 'touchup_closed', 'touchup_exists', 'rate_limited', 'bad_request', 'not_found']);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function rpc(fn, args, retries = 2) {
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
          method: 'POST', signal: ctrl.signal,
          headers: { apikey: CFG.supabaseAnonKey, Authorization: `Bearer ${CFG.supabaseAnonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        clearTimeout(timer);
        const text = await res.text();
        let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { }
        if (!res.ok) {
          const code = body && body.message && KNOWN.has(body.message) ? body.message : null;
          const err = new Error(code || `http_${res.status}`); err.code = code;
          if (code || (res.status >= 400 && res.status < 500)) err.final = true;
          throw err;
        }
        return body;
      } catch (e) {
        clearTimeout(timer);
        if (e.final || attempt >= retries) { if (!e.code) e.code = navigator.onLine === false ? 'offline' : null; throw e; }
        await sleep(700 * (attempt + 1));
      }
    }
  }

  async function load(silent) {
    if (!token) { S.fatal = 'invalid_link'; S.loading = false; render(); return; }
    try {
      const data = await rpc('portal_get', { p_token: token });
      setData(data); S.offline = false; S.fatal = null;
    } catch (e) {
      if (e.code === 'invalid_link') { S.fatal = 'invalid_link'; S.data = null; try { localStorage.removeItem(CACHE_KEY); } catch (_) { } }
      else if (S.data) S.offline = true;
      else S.fatal = 'network';
    }
    S.loading = false;
    if (!silent || !sheetOpen()) render(); else renderTabs();
    schedulePoll();
  }
  function setData(d) {
    S.data = d; A.store.set(CACHE_KEY, d);
    applyBackground();
  }
  // Run an action; on success the server returns the fresh home data
  async function act(fn, args, okMsg, btn, retries = 1) {
    if (btn) btn.classList.add('busy');
    try {
      const d = await rpc(fn, Object.assign({ p_token: token }, args), retries);
      if (d && d.customer) setData(d);
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      toast(A.errorText(e.code));
      if (e.code === 'invalid_link') { S.fatal = 'invalid_link'; closeSheet(); render(); }
      return false;
    } finally { if (btn) btn.classList.remove('busy'); }
  }

  // live updates on visit day, light refresh otherwise
  let pollTimer;
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (S.fatal === 'invalid_link') return;
    const st = S.data && S.data.next_visit && S.data.next_visit.status;
    const fast = st === 'on_the_way' || st === 'arrived' || (S.data && S.data.next_visit && isToday(S.data.next_visit.scheduled_date));
    pollTimer = setTimeout(() => { if (document.visibilityState === 'visible') load(true); else schedulePoll(); }, fast ? 20000 : 90000);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data) load(true); });
  window.addEventListener('online', () => { if (S.data || S.fatal === 'network') load(true); });

  // ---------- helpers ----------
  const D = () => S.data;
  const C = () => S.data.customer;
  const isToday = s => s && A.isoDate(A.today()) === String(s).slice(0, 10);
  const areaById = id => (D().areas || []).find(a => a.id === id);
  const homePhoto = () => C().home_photo_url || '/assets/home-default.jpg';
  const firstName = () => (C() && C().first_name) || '';
  const homeName = () => C().home_name || `The ${C().last_name || C().first_name} Home`;
  const teamNames = list => { const n = (list || []).map(t => typeof t === 'string' ? t : t.name); return n.length <= 1 ? (n[0] || 'Your team') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
  const openRequest = kind => (D().requests || []).find(r => r.kind === kind);
  const plan = () => A.planPriorities(D().areas || [], D().next_visit, C().cadence_days, CFG.prioritiesPerVisit);
  const lastVisit = () => (D().visits || [])[0];
  const touchupOpen = v => v && !v.touchup && v.finished_at && (Date.now() - new Date(v.finished_at).getTime()) < 48 * 3600e3;

  function applyBackground() {
    const bg = S.previewBg || (S.data && C().background) || 'cloud';
    document.documentElement.setAttribute('data-bg', bg);
    if (S.data) $('photoBg').style.backgroundImage = `url("${homePhoto()}")`;
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = bg === 'midnight' ? '#06111E' : bg === 'linen' ? '#F6F3EE' : '#F2F6FB';
  }

  // ---------- icons ----------
  const ICON = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    plan: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    visits: '<rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-9 8"/>',
    myhome: '<path d="M4 20V9l8-5 8 5v11z"/><path d="M9 13h6M9 16h6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  };
  const svg = (p, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const TABS = [['home', 'Home'], ['plan', 'Priorities'], ['visits', 'Visits'], ['myhome', 'My home']];
  function renderTabs() {
    const show = S.data && !S.fatal;
    $('tabs').hidden = !show;
    if (!show) return;
    $('tabs').innerHTML = TABS.map(([id, l]) => `<button type="button" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ''}>${svg(ICON[id], 22)}${l}</button>`).join('');
  }
  const msgButton = () => `<button type="button" class="round" data-act="messages" aria-label="Messages">${svg(ICON.chat, 19)}${D().unread > 0 ? '<span class="dot"></span>' : ''}</button>`;
  const topbar = () => `<div class="topbar"><img class="logo" src="/assets/logo-${C().background === 'midnight' ? 'white' : 'blue'}.png" alt="Alora">${msgButton()}</div>`;

  // ---------- HOME ----------
  function nextVisitCard() {
    const c = C(), v = D().next_visit;
    if (c.status === 'paused') return `<section class="next glass card"><span class="pill plain">Paused</span><div class="day" style="margin:12px 0 6px">On pause</div>
      <p class="muted">Your plan, home details and team are saved for when you're ready.</p>
      ${openRequest('resume') ? `<div class="note-line">You asked to resume. We'll confirm your next date shortly.</div>` : `<button type="button" class="btn block" style="margin-top:16px" data-act="resume">Resume my visits</button>`}</section>`;
    if (c.status === 'cancelled') return `<section class="next glass card"><div class="day" style="margin-bottom:8px">Thank you</div><p class="muted">Your membership has ended. Your visit history stays here whenever you need it.</p></section>`;
    if (!v) return `<section class="next glass card"><span class="muted small">Next visit</span><div class="day" style="margin:10px 0 6px;font-size:40px">Being scheduled</div><p class="muted">We'll let you know as soon as your next date is set.</p></section>`;

    const d = A.parseDate(v.scheduled_date), days = A.daysBetween(A.today(), d);
    const live = v.status === 'on_the_way' || v.status === 'arrived';
    const today = days === 0 || live;
    const team = D().team || [];
    const req = openRequest('reschedule'), skip = openRequest('skip');
    const pill = live ? (v.status === 'on_the_way' ? 'On the way' : 'Cleaning now') : days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
    let liveBlock = '';
    if (v.status === 'on_the_way') liveBlock = `<div class="live"><img src="/assets/splash.jpg" alt=""><div><div class="title">${esc(teamNames(team))} ${team.length > 1 ? 'are' : 'is'} on the way</div><div class="small muted">Left ${A.time(v.on_the_way_at)}</div></div></div>`;
    if (v.status === 'arrived') liveBlock = `<div class="live"><div class="ico">🏡</div><div><div class="title">Arrived at ${A.time(v.arrived_at)}</div><div class="small muted">Your report will appear here when they finish</div></div></div>`;
    return `<section class="next glass card">
      <div class="row between"><span class="muted small">${today ? 'Today' : 'Next visit'}</span><span class="pill blue">${pill}</span></div>
      <div class="day" style="margin:10px 0 6px">${today ? 'Today' : A.fmt(d, { weekday: 'long' })}</div>
      <div class="muted">${today ? '' : A.fmt(d, { month: 'long', day: 'numeric' }) + ', '}arriving ${esc(v.window_label)}</div>
      ${live ? `<div class="steps" aria-hidden="true"><i class="on"></i><i class="${v.status === 'arrived' ? 'on' : ''}"></i><i></i></div>` : ''}
      ${liveBlock}
      ${team.length ? `<div class="row" style="margin-top:18px;gap:10px"><div class="avatars">${team.map(t => `<div class="avatar" style="background:${esc(t.color)}">${esc(t.name[0])}</div>`).join('')}</div><span class="small">${esc(teamNames(team))}</span></div>` : ''}
      ${v.client_request ? `<div class="note-line">You asked: ${esc(v.client_request)}</div>` : ''}
      ${req ? `<div class="note-line">Date change requested: ${esc(req.details || '')}. We'll confirm shortly.</div>` : ''}
      ${skip ? `<div class="note-line">Skip requested. We'll confirm shortly.</div>` : ''}
      ${v.status === 'scheduled' && !today ? `<div class="grid2" style="margin-top:18px"><button type="button" class="btn" data-act="priorities">Set priorities</button><button type="button" class="btn soft" data-act="reschedule">Change date</button></div>` : ''}
    </section>`;
  }
  function finishedTodayCard() {
    const v = lastVisit();
    if (!v || !v.finished_at || !isToday(A.isoDate(new Date(v.finished_at)))) return '';
    return `<button type="button" class="glass card row" style="width:100%;text-align:left;margin-top:12px" data-act="visit" data-id="${v.id}">
      <div class="ico">✨</div><div class="grow"><div class="title">Finished at ${A.time(v.finished_at)}</div><div class="small muted">Your visit report is ready</div></div><span class="pill blue">View</span></button>`;
  }
  function viewHome() {
    const groups = plan(), next = groups[0], v = lastVisit(), c = C();
    const headline = c.status === 'paused' ? 'Your home, on pause.' : 'Your home is taken care of.';
    return `
    <section class="hero" style="background-image:url('${esc(homePhoto())}')">
      <div class="topbar on-photo"><img class="logo" src="/assets/logo-white.png" alt="Alora">${msgButton()}</div>
      <div class="greet"><p>${A.greeting()}, ${esc(firstName())}</p><h1>${headline}</h1></div>
    </section>
    ${nextVisitCard()}
    <div class="pad">
      ${finishedTodayCard()}
      ${next && c.status === 'active' ? `
      <div class="sec"><h2>Priorities this visit</h2><button type="button" class="link" data-tab="plan">Full rotation</button></div>
      <p class="muted small" style="margin:-4px 4px 12px">A full deep clean of your whole home, with extra attention on:</p>
      <div class="hscroll">
        ${next.areas.map(a => `<div class="tile glass"><div class="ico">${esc(a.icon)}</div><div class="big">${esc(a.name)}</div><div class="small muted" style="margin-top:6px">${a.last_done ? 'Last time ' + A.short(A.parseDate(a.last_done)) : 'First time'}</div></div>`).join('')}
        <button type="button" class="tile glass" data-tab="plan"><div class="ico">✦</div><div class="big">${(D().areas || []).length} areas in your rotation</div><div class="small muted" style="margin-top:6px">See what's coming up</div></button>
      </div>` : ''}
      ${v ? `
      <div class="sec"><h2>Last visit</h2><span class="small muted">${A.long(A.parseDate(v.scheduled_date))}</span></div>
      ${visitCard(v, 210)}
      ${touchupOpen(v) ? `<button type="button" class="glass card row" style="width:100%;text-align:left;margin-top:12px;padding:16px 18px" data-act="touchup" data-id="${v.id}"><div class="ico">🔎</div><div class="grow"><div class="title">Something missed?</div><div class="small muted">Tell us within 48 hours and we'll come back to fix it.</div></div></button>` : ''}
      ${v.touchup ? `<div class="glass card row" style="margin-top:12px;padding:16px 18px"><div class="ico">🛠️</div><div class="grow"><div class="title">Touch-up ${v.touchup.status === 'done' ? 'completed' : v.touchup.status === 'scheduled' ? 'scheduled' : 'requested'}</div><div class="small muted">${esc([v.touchup.areas, v.touchup.note].filter(Boolean).join(': '))}</div></div></div>` : ''}
      ` : `<div class="sec"><h2>Visit reports</h2></div><div class="glass card"><p class="muted">After each visit, you'll find photos, notes and everything we did right here.</p></div>`}
    </div>`;
  }
  function visitCard(v, h) {
    const p = (v.photos || [])[0];
    const pris = (v.priorities || []).map(id => areaById(id)).filter(Boolean).map(a => a.name);
    const sub = pris.length ? 'Extra attention: ' + pris.join(' and ') : 'Full home deep clean';
    return `<button type="button" class="photo-card ${p ? '' : 'noimg'}" data-act="visit" data-id="${v.id}">
      ${p ? `<img src="${esc(p.url)}" alt="" loading="lazy" style="height:${h}px">` : `<div class="ph"></div>`}
      <span class="pill tag">${v.rating ? '★ ' + v.rating : 'Rate this visit'}</span>
      <div class="over"><div class="title">${esc(A.long(A.parseDate(v.scheduled_date)))}</div><div class="small" style="opacity:.88">${esc(sub)}</div></div>
    </button>`;
  }

  // ---------- PRIORITIES ----------
  function viewPlan() {
    const groups = plan(), v = D().next_visit;
    return `${topbar()}<div class="pad">
      <h1 style="margin-top:6px">Priorities</h1>
      <p class="muted" style="margin:12px 0 22px">Every visit is a full deep clean of your whole home. On top of that, each visit gives extra attention to a few areas on a rotation, so every corner gets its turn.</p>
      ${!groups.length ? `<div class="glass card"><p class="muted">Your rotation will appear here once your next visit is scheduled.</p></div>` : groups.map((g, i) => `
      <section class="group glass">
        <div class="ghead"><div><div class="title">${i === 0 ? 'Next visit' : A.fmt(g.date, { weekday: 'long' })}</div><div class="small muted">${A.fmt(g.date, { month: 'long', day: 'numeric' })}</div></div>
          ${i === 0 ? `<span class="pill blue">${g.pinned ? 'Your picks' : 'Up next'}</span>` : `<span class="pill plain">Planned</span>`}</div>
        ${g.areas.map(a => `<div class="item" style="padding:12px 0"><div class="ico">${esc(a.icon)}</div><div class="grow"><div class="title">${esc(a.name)}</div><div class="small muted">${a.last_done ? 'Last extra attention ' + A.short(A.parseDate(a.last_done)) : 'First time in the rotation'}</div></div></div>`).join('')}
        ${i === 0 && v && v.status === 'scheduled' && C().status === 'active' ? `<button type="button" class="btn soft block" style="margin:8px 0 4px" data-act="priorities">Change priorities</button>` : ''}
      </section>`).join('')}
    </div>`;
  }

  // ---------- VISITS ----------
  function viewVisits() {
    const vs = D().visits || [], s = D().settings || {};
    return `${topbar()}<div class="pad">
      <h1 style="margin-top:6px">Visits</h1>
      <p class="muted" style="margin:12px 0 22px">Photos, notes and everything we did at each visit.</p>
      ${vs.length ? vs.map((v, i) => `<div style="margin-bottom:14px">${visitCard(v, i ? 160 : 210)}</div>`).join('') : `<div class="glass card"><p class="muted">Your first visit report will appear here after your first clean.</p></div>`}
      ${s.referral_offer ? `<section class="cta-band"><h2 style="font-weight:300;font-size:24px">Give a visit, get a visit</h2><p style="margin-top:8px;opacity:.92;position:relative;z-index:1">${esc(s.referral_offer)}</p>${s.referral_url ? `<button type="button" class="btn" data-act="refer">Share my invite</button>` : ''}</section>` : ''}
    </div>`;
  }
  function visitSheet(id) {
    const v = (D().visits || []).find(x => x.id === id); if (!v) return '';
    const pris = (v.priorities || []).map(areaById).filter(Boolean);
    const s = D().settings || {};
    return `<div class="grabber"></div>
      <h2 class="big">${esc(A.long(A.parseDate(v.scheduled_date)))}</h2>
      <p class="muted small">${esc(teamNames(v.team))}${v.finished_at ? ', finished ' + A.time(v.finished_at) : ''}</p>
      ${(v.photos || []).length ? `<div class="gallery">${v.photos.map(p => `<figure><img src="${esc(p.url)}" alt="${esc(p.caption || '')}" loading="lazy">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
      <h3>What we did</h3>
      <ul class="checklist">${(v.checklist || []).map(c => `<li>${esc(c)}</li>`).join('')}${pris.map(a => `<li class="pri">Extra attention: ${esc(a.name)}</li>`).join('')}</ul>
      ${v.team_note ? `<div class="note-line" style="margin-top:16px"><strong>From your team:</strong> ${esc(v.team_note)}</div>` : ''}
      ${v.touchup ? `<div class="glass card" style="margin-top:16px;padding:16px"><div class="title">Touch-up ${v.touchup.status === 'done' ? 'completed' : v.touchup.status === 'scheduled' ? 'scheduled' : 'requested'}</div><div class="small muted">${esc([v.touchup.areas, v.touchup.note].filter(Boolean).join(': '))}</div></div>`
        : touchupOpen(v) ? `<button type="button" class="btn soft block" style="margin-top:16px" data-act="touchup" data-id="${v.id}">Something missed?</button>` : ''}
      <h3>How was this visit?</h3>
      <div class="stars" role="group" aria-label="Rate this visit">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star ${n <= (v.rating || 0) ? 'on' : ''}" data-act="rate" data-id="${v.id}" data-n="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      ${v.rating === 5 && s.google_review_url ? `<div class="glass card" style="margin-top:14px;padding:16px"><div class="title">So glad you loved it</div><p class="small muted" style="margin:4px 0 12px">A Google review helps other families find Alora.</p><a class="btn block" href="${esc(s.google_review_url)}" target="_blank" rel="noopener">Leave a Google review</a></div>` : ''}
      <h3>Thank the team</h3>
      <div class="chips">${[10, 20, 30].map(t => `<button type="button" class="chip" data-act="tip" data-id="${v.id}" data-t="${t}" aria-pressed="${Number(v.tip) === t}">$${t}</button>`).join('')}</div>
      <p class="small muted" style="margin:10px 0 22px">${v.tip ? `${A.money(v.tip)} will be added to your next charge and goes 100% to the team. Tap again to remove.` : 'Tips are added to your next charge and go 100% to the team.'}</p>
      <button type="button" class="btn soft block" data-act="close">Done</button>`;
  }
  function touchupSheet(id) {
    return `<div class="grabber"></div><h2 class="big">Something missed?</h2>
      <p class="muted" style="margin-bottom:14px">Tell us what wasn't right. We'll come back and fix it at no charge.</p>
      <div class="chips" id="tuAreas">${['Kitchen', 'Bathrooms', 'Bedrooms', 'Living areas', 'Floors', 'Other'].map(r => `<button type="button" class="chip" data-act="toggle" aria-pressed="false">${r}</button>`).join('')}</div>
      <label class="f" for="tuNote">What should we look at?</label><textarea id="tuNote" rows="3" maxlength="1000" placeholder="For example: streaks on the shower glass"></textarea>
      <button type="button" class="btn block" style="margin-top:16px" data-act="send-touchup" data-id="${id}">Request a touch-up</button>`;
  }

  // ---------- MY HOME ----------
  function viewMyHome() {
    const c = C();
    return `${topbar()}
      <section class="cover" style="background-image:url('${esc(homePhoto())}')"><button type="button" class="edit" data-act="personalize">Personalize</button>
        <div><div style="font-size:28px;font-weight:200;letter-spacing:-.03em">${esc(homeName())}</div>
        <div class="small" style="opacity:.9">${[c.beds ? `${+c.beds} bed` : '', c.baths ? `${+c.baths} bath` : '', c.sqft ? `${Number(c.sqft).toLocaleString()} sq ft` : ''].filter(Boolean).join(', ') || esc(c.address || '')}</div></div></section>
      <div class="seg glass" role="tablist">${[['home', 'Home'], ['guide', 'Care guide'], ['membership', 'Membership']].map(([k, l]) => `<button type="button" role="tab" data-act="seg" data-k="${k}" aria-pressed="${S.seg === k}">${l}</button>`).join('')}</div>
      <div class="pad" style="margin-top:18px">${({ home: segHome, guide: segGuide, membership: segMembership })[S.seg]()}</div>`;
  }
  function kvs(rows) { const r = rows.filter(x => x[1] !== null && x[1] !== undefined && x[1] !== ''); return r.length ? `<dl>${r.map(([k, v]) => `<div class="kv"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : `<p class="muted">Nothing here yet.</p>`; }
  function segHome() {
    const c = C(), notes = D().notes || [];
    return `
      ${c.household || c.pets || c.year_built || c.address ? `<div class="glass card">${kvs([['Address', c.address], ['Household', c.household], ['Pets', c.pets], ['Built', c.year_built]])}</div>` : ''}
      <div class="sec"><h2>Good to know</h2><button type="button" class="link" data-act="edit-gtk">Edit</button></div>
      <div class="glass card"><p class="${c.good_to_know ? '' : 'muted'}" style="white-space:pre-wrap">${esc(c.good_to_know || 'Nap times, who works from home, anything that helps visits go smoothly.')}</p></div>
      <div class="sec"><h2>How you like things</h2><button type="button" class="link" data-act="edit-prefs">Edit</button></div>
      <div class="glass card">${kvs([['Scent', c.scent], ['Linens', c.linens], ['Sensitivities', c.sensitivities || 'None noted'], ['Please leave alone', c.leave_alone || 'Nothing noted']])}
        <p class="small muted" style="margin-top:14px">Entry details are shared with your assigned team on visit day only.</p></div>
      ${notes.length ? `<div class="sec"><h2>Notes from your team</h2></div>
      <div class="list glass">${notes.map(n => `<div class="item"><div class="ico">${n.resolved ? '✓' : '📝'}</div><div class="grow"><div class="title">${esc(n.note)}</div><div class="small muted">Noticed ${A.short(new Date(n.created_at))}</div></div>${n.resolved ? '<span class="pill green">Taken care of</span>' : `<button type="button" class="chip" style="min-height:36px;padding:6px 12px;font-size:13px" data-act="note-done" data-id="${n.id}">Taken care of</button>`}</div>`).join('')}</div>
      <p class="small muted" style="margin:12px 4px 0">Things your team happened to notice while cleaning. A courtesy, not a home inspection.</p>` : ''}`;
  }
  function segGuide() {
    const rooms = {}; (D().surfaces || []).forEach(s => (rooms[s.room] = rooms[s.room] || []).push(s));
    const spots = D().spots || [];
    return `<p class="muted" style="margin-bottom:16px">How your team cares for the materials in your home, and where the important things are.</p>
      ${Object.keys(rooms).length ? Object.entries(rooms).map(([room, items]) => `<section class="glass card" style="margin-bottom:12px"><h2 style="margin-bottom:6px">${esc(room)}</h2>${items.map(s => `<div class="surface"><div class="title">${esc(s.name)}</div>${s.care_note ? `<div class="small muted">${esc(s.care_note)}</div>` : ''}</div>`).join('')}</section>`).join('')
        : `<div class="glass card" style="margin-bottom:12px"><p class="muted">Your team records your surfaces and how to care for them at your first visit.</p></div>`}
      ${spots.length ? `<div class="sec"><h2>Key spots</h2></div><div class="list glass">${spots.map(k => `<div class="item"><div class="ico">${esc(k.icon)}</div><div class="grow"><div class="title">${esc(k.name)}</div><div class="small muted">${esc(k.location || 'Not recorded yet')}</div></div></div>`).join('')}</div>` : ''}
      <button type="button" class="btn soft block" style="margin-top:14px" data-act="suggest">Suggest a change</button>`;
  }
  function segMembership() {
    const c = C(), v = D().next_visit, paid = (D().visits || []).filter(x => x.amount);
    const reqs = D().requests || [];
    const label = { reschedule: 'Date change', skip: 'Skip next visit', pause: 'Pause', resume: 'Resume', cancel: 'Cancellation', detail_change: 'Change request' };
    return `<section class="glass card">
        <div class="row between"><h2>${esc(c.plan_name)}</h2><span class="pill ${c.status === 'active' ? 'green' : 'plain'}">${c.status === 'active' ? 'Active' : c.status === 'paused' ? 'Paused' : 'Ended'}</span></div>
        <p class="muted" style="margin-top:8px">${A.cadenceLabel(c.cadence_days)}. ${A.money(c.price)} per visit${c.card_last4 ? `, charged after each visit to the card ending in ${esc(c.card_last4)}` : ''}.</p>
      </section>
      ${c.status === 'active' && v && v.status === 'scheduled' ? `<div class="sec"><h2>Your schedule</h2></div>
      <section class="glass card"><p style="margin-bottom:14px">Next visit: ${esc(A.long(A.parseDate(v.scheduled_date)))}, ${esc(v.window_label)}</p>
        <div class="grid2"><button type="button" class="btn soft" data-act="reschedule">Change date</button><button type="button" class="btn soft" data-act="skip" ${openRequest('skip') ? 'disabled' : ''}>${openRequest('skip') ? 'Skip requested' : 'Skip visit'}</button></div></section>` : ''}
      ${reqs.length ? `<div class="sec"><h2>Waiting on us</h2></div><div class="list glass">${reqs.map(r => `<div class="item"><div class="grow"><div class="title">${label[r.kind] || 'Request'}</div><div class="small muted">${esc(r.details || 'We\'ll confirm shortly.')}</div></div><span class="pill blue">Sent</span></div>`).join('')}</div>` : ''}
      <div class="sec"><h2>Receipts</h2></div>
      <div class="list glass">${paid.length ? paid.map(x => `<div class="item"><div class="grow"><div class="title">${esc(A.long(A.parseDate(x.scheduled_date)))}</div><div class="small muted">Visit ${A.money(x.amount)}${x.tip ? `, tip ${A.money(x.tip)}` : ''}</div></div><div class="title">${A.money(Number(x.amount) + Number(x.tip || 0))}</div></div>`).join('') : `<div class="empty">Receipts appear here after each visit.</div>`}</div>
      <div class="sec"><h2>Share with your household</h2></div>
      <section class="glass card"><p class="muted small" style="margin-bottom:14px">Anyone with your link can see your home and message your team. Share it only with people in your household.</p>
        <button type="button" class="btn soft block" data-act="share-link">Share my link</button>
        <p class="small muted" style="margin-top:14px">Tip: open this page in Safari, tap Share, then Add to Home Screen to use Alora like an app.</p></section>
      ${c.status === 'active' ? `<button type="button" class="btn soft block" style="margin-top:22px" data-act="leave">Pause or cancel</button>` : ''}
      ${c.status === 'paused' && !openRequest('resume') ? `<button type="button" class="btn block" style="margin-top:22px" data-act="resume">Resume my visits</button>` : ''}`;
  }

  // ---------- sheets ----------
  function prioritiesSheet() {
    const v = D().next_visit, cur = plan()[0];
    const picked = new Set(cur ? cur.areas.map(a => a.id) : []);
    return `<div class="grabber"></div><h2 class="big">Set priorities</h2>
      <p class="muted" style="margin-bottom:16px">Your whole home is always deep cleaned. Pick up to three areas for extra attention on ${esc(A.fmt(A.parseDate(v.scheduled_date), { weekday: 'long', month: 'long', day: 'numeric' }))}.</p>
      <div class="chips" id="priAreas">${(D().areas || []).map(a => `<button type="button" class="chip" data-act="pick" data-id="${a.id}" aria-pressed="${picked.has(a.id)}">${esc(a.icon)} ${esc(a.name)}</button>`).join('')}</div>
      <label class="f" for="priNote">Anything else we should know?</label>
      <textarea id="priNote" rows="2" maxlength="500" placeholder="For example: guests arriving Saturday, guest room first">${esc(v.client_request || '')}</textarea>
      <button type="button" class="btn block" style="margin-top:16px" data-act="save-priorities">Save priorities</button>`;
  }
  function rescheduleSheet() {
    const r = openRequest('reschedule');
    return `<div class="grabber"></div><h2 class="big">Change the date</h2>
      <p class="muted" style="margin-bottom:14px">Tell us what works better and we'll confirm with your team. Changes need at least 48 hours' notice.</p>
      <div class="chips" id="rsQuick">${['Earlier that week', 'Later that week', 'The week after', 'A different time of day'].map(o => `<button type="button" class="chip" data-act="single" aria-pressed="false">${o}</button>`).join('')}</div>
      <label class="f" for="rsNote">Preferred day and time</label><textarea id="rsNote" rows="2" maxlength="500" placeholder="For example: Friday morning instead">${esc(r ? r.details || '' : '')}</textarea>
      <button type="button" class="btn block" style="margin-top:16px" data-act="send-reschedule">Send request</button>`;
  }
  function messagesSheet() {
    const m = D().messages || [];
    return `<div class="grabber"></div><h2 class="big">Your Alora team</h2>
      <div class="chat" id="chat">${m.length ? m.map(x => `<div class="msg ${x.sender}">${esc(x.body)}<time>${A.short(new Date(x.created_at))}, ${A.time(x.created_at)}</time></div>`).join('') : `<p class="muted">Questions, requests, anything. We usually reply within a few hours.</p>`}</div>
      <div class="row" style="align-items:flex-end"><textarea id="msgIn" rows="1" maxlength="2000" placeholder="Write a message" aria-label="Message" style="flex:1"></textarea><button type="button" class="btn" data-act="send-msg">Send</button></div>`;
  }
  const BGS = [['cloud', 'Cloud', 'linear-gradient(135deg,#F2F6FB,#C3DBFA)'], ['sky', 'Sky', 'linear-gradient(135deg,#B4D5FB,#3D93F5)'], ['lagoon', 'Lagoon', 'linear-gradient(135deg,#EAF3F8,#93C9EE 60%,#A6DCE6)'],
    ['linen', 'Linen', 'linear-gradient(135deg,#F6F3EE,#E8DCCC)'], ['midnight', 'Midnight', 'linear-gradient(135deg,#0E3767,#06111E)'], ['photo', 'My home', '']];
  function personalizeSheet() {
    const cur = S.previewBg || C().background;
    return `<div class="grabber"></div><h2 class="big">Personalize</h2>
      <label class="f" for="hn">Home name</label><input type="text" id="hn" maxlength="80" value="${esc(homeName())}">
      <label class="f">Background</label>
      <div class="swatches">${BGS.map(([k, l, g]) => `<button type="button" class="swatch" data-act="bg" data-k="${k}" aria-pressed="${cur === k}" style="background:${k === 'photo' ? `center/cover url('${esc(homePhoto())}')` : g}"><span>${l}</span></button>`).join('')}</div>
      <p class="small muted" style="margin-top:12px">Want your own photo of your home? Send it to us in Messages and we'll add it.</p>
      <button type="button" class="btn block" style="margin-top:16px" data-act="save-personalize">Save</button>`;
  }
  function gtkSheet() {
    return `<div class="grabber"></div><h2 class="big">Good to know</h2><p class="muted" style="margin-bottom:12px">Nap times, who's home, anything that helps visits go smoothly.</p>
      <textarea id="gtk" rows="5" maxlength="2000">${esc(C().good_to_know || '')}</textarea>
      <button type="button" class="btn block" style="margin-top:16px" data-act="save-gtk">Save</button>`;
  }
  function prefsSheet() {
    const c = C(), sel = (id, opts, v) => `<select id="${id}">${opts.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    return `<div class="grabber"></div><h2 class="big">How you like things</h2>
      <div class="grid2"><div><label class="f" for="pScent">Scent</label>${sel('pScent', ['None', 'Eucalyptus', 'Lavender', 'Citrus'], c.scent)}</div><div><label class="f" for="pLinens">Linens</label>${sel('pLinens', ['Hotel fold', 'Tucked', 'Leave as is'], c.linens)}</div></div>
      <label class="f" for="pSens">Allergies and sensitivities</label><input type="text" id="pSens" maxlength="500" value="${esc(c.sensitivities || '')}">
      <label class="f" for="pLeave">Please leave alone</label><input type="text" id="pLeave" maxlength="500" value="${esc(c.leave_alone || '')}">
      <button type="button" class="btn block" style="margin-top:18px" data-act="save-prefs">Save</button>`;
  }
  function leaveSheet() {
    return `<div class="grabber"></div><h2 class="big">Before you go</h2>
      <p class="muted" style="margin-bottom:16px">You can take a break without losing your plan, your home details, or your team.</p>
      <div style="display:grid;gap:10px">
        <button type="button" class="btn" data-act="req" data-kind="pause" data-msg="Pause for one month">Pause for a month</button>
        <button type="button" class="btn soft" data-act="req" data-kind="detail_change" data-msg="Switch to every 4 weeks">Switch to every 4 weeks</button>
        <button type="button" class="btn soft" data-act="messages">Talk to us first</button>
      </div>
      <button type="button" class="link" style="margin-top:20px;color:var(--ink-2)" data-act="confirm-cancel">Cancel my membership</button>`;
  }
  function cancelSheet() {
    return `<div class="grabber"></div><h2 class="big">Cancel membership</h2>
      <p class="muted" style="margin-bottom:12px">We're sorry to see you go. Anything we could have done better?</p>
      <textarea id="cxNote" rows="3" maxlength="1000" placeholder="Optional"></textarea>
      <button type="button" class="btn block" style="margin-top:16px;background:#B4463A" data-act="send-cancel">Request cancellation</button>
      <button type="button" class="btn soft block" style="margin-top:10px" data-act="close">Keep my membership</button>`;
  }

  // ---------- sheet + toast ----------
  let sheetKind = null, sheetArg = null;
  const sheetOpen = () => $('sheet').classList.contains('open');
  function openSheet(kind, arg) {
    sheetKind = kind; sheetArg = arg;
    const html = ({ visit: visitSheet, touchup: touchupSheet, priorities: prioritiesSheet, reschedule: rescheduleSheet, messages: messagesSheet, personalize: personalizeSheet, gtk: gtkSheet, prefs: prefsSheet, leave: leaveSheet, cancel: cancelSheet })[kind](arg);
    $('sheetBody').innerHTML = html;
    $('sheet').classList.add('open'); $('sheet').setAttribute('aria-hidden', 'false'); $('scrim').classList.add('open');
    document.body.style.overflow = 'hidden';
    if (kind === 'messages') { const ch = $('chat'); if (ch) ch.scrollTop = ch.scrollHeight; }
  }
  function refreshSheet() { if (sheetOpen() && sheetKind) { const st = $('sheetBody').scrollTop; openSheet(sheetKind, sheetArg); $('sheetBody').scrollTop = st; } }
  function closeSheet() {
    $('sheet').classList.remove('open'); $('sheet').setAttribute('aria-hidden', 'true'); $('scrim').classList.remove('open');
    document.body.style.overflow = '';
    if (S.previewBg) { S.previewBg = null; applyBackground(); }
    sheetKind = null;
  }
  let toastTimer;
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800); }
  const val = id => ($(id) ? $(id).value.trim() : '');

  // ---------- render ----------
  function render() {
    renderTabs();
    const view = $('view');
    if (S.fatal === 'invalid_link') {
      view.innerHTML = `<div class="center-screen"><img src="/assets/logo-blue.png" alt="Alora"><h1>This link isn't active</h1><p class="muted" style="margin-top:14px">It may have been replaced with a new one. Text us and we'll send you your current link.</p></div>`;
      return;
    }
    if (S.fatal === 'network') {
      view.innerHTML = `<div class="center-screen"><img src="/assets/logo-blue.png" alt="Alora"><h1>Can't reach your home right now</h1><p class="muted" style="margin:14px 0 22px">Check your connection and try again.</p><button type="button" class="btn" data-act="retry">Try again</button></div>`;
      return;
    }
    if (!S.data) { view.innerHTML = `<div class="skeleton" style="height:420px;margin:0 0 16px;border-radius:0 0 32px 32px"></div><div class="skeleton"></div><div class="skeleton"></div>`; return; }
    const banner = S.offline ? `<div class="banner glass">Showing your saved info. Reconnecting…</div>` : '';
    view.innerHTML = banner + ({ home: viewHome, plan: viewPlan, visits: viewVisits, myhome: viewMyHome })[S.tab]();
    if (sheetOpen()) refreshSheet();
  }

  // ---------- events ----------
  document.addEventListener('click', async e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { S.tab = tab.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); return; }
    if (e.target === $('scrim')) { closeSheet(); return; }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, id = el.dataset.id, v = S.data && D().next_visit;
    switch (a) {
      case 'retry': S.fatal = null; S.loading = true; render(); load(); break;
      case 'close': closeSheet(); break;
      case 'seg': S.seg = el.dataset.k; render(); break;
      case 'toggle': el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true'); break;
      case 'single': el.parentElement.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === el && el.getAttribute('aria-pressed') !== 'true')); break;
      case 'messages':
        openSheet('messages');
        if (D().unread > 0) { D().unread = 0; render(); rpc('portal_mark_read', { p_token: token }, 1).catch(() => { }); }
        break;
      case 'send-msg': {
        const body = val('msgIn'); if (!body) break;
        if (await act('portal_send_message', { p_body: body }, null, el, 0)) { refreshSheet(); render(); }
        break;
      }
      case 'visit': openSheet('visit', id); break;
      case 'rate': if (await act('portal_rate_visit', { p_visit_id: id, p_rating: +el.dataset.n, p_tip: null }, 'Thank you. Your team will see this.')) { refreshSheet(); render(); } break;
      case 'tip': {
        const vv = (D().visits || []).find(x => x.id === id), t = +el.dataset.t;
        const newTip = Number(vv && vv.tip) === t ? 0 : t;
        if (await act('portal_rate_visit', { p_visit_id: id, p_rating: null, p_tip: newTip }, newTip ? `Thank you. ${A.money(newTip)} goes to the team.` : 'Tip removed')) refreshSheet();
        break;
      }
      case 'touchup': openSheet('touchup', id); break;
      case 'send-touchup': {
        const areas = [...document.querySelectorAll('#tuAreas [aria-pressed="true"]')].map(c => c.textContent).join(', ');
        const note = val('tuNote');
        if (!areas && !note) { toast('Pick a room or add a note'); break; }
        if (await act('portal_report_touchup', { p_visit_id: id, p_areas: areas, p_note: note }, 'Touch-up requested. We\'ll confirm a time soon.', el)) { closeSheet(); render(); }
        break;
      }
      case 'priorities': if (v) openSheet('priorities'); break;
      case 'pick': {
        const on = el.getAttribute('aria-pressed') === 'true';
        if (!on && document.querySelectorAll('#priAreas [aria-pressed="true"]').length >= 3) { toast('Pick up to three areas'); break; }
        el.setAttribute('aria-pressed', !on); break;
      }
      case 'save-priorities': {
        const ids = [...document.querySelectorAll('#priAreas [aria-pressed="true"]')].map(c => c.dataset.id);
        if (await act('portal_set_priorities', { p_visit_id: v.id, p_area_ids: ids, p_note: val('priNote') }, ids.length ? 'Priorities saved. Your team will see them.' : 'Back to your regular rotation', el)) { closeSheet(); render(); }
        break;
      }
      case 'reschedule': openSheet('reschedule'); break;
      case 'send-reschedule': {
        const quick = document.querySelector('#rsQuick [aria-pressed="true"]'), note = val('rsNote');
        const details = [quick && quick.textContent, note].filter(Boolean).join('. ');
        if (!details) { toast('Tell us what works better'); break; }
        if (await act('portal_request', { p_kind: 'reschedule', p_details: details }, 'Request sent. We\'ll confirm shortly.', el)) { closeSheet(); render(); }
        break;
      }
      case 'skip': if (await act('portal_request', { p_kind: 'skip', p_details: v ? 'Skip ' + A.long(A.parseDate(v.scheduled_date)) : 'Skip next visit' }, 'Skip requested. We\'ll confirm shortly.', el)) render(); break;
      case 'resume': if (await act('portal_request', { p_kind: 'resume', p_details: 'Ready to resume visits' }, 'Welcome back. We\'ll confirm your next date.', el)) render(); break;
      case 'req': if (await act('portal_request', { p_kind: el.dataset.kind, p_details: el.dataset.msg }, 'Request sent. We\'ll confirm shortly.', el)) { closeSheet(); render(); } break;
      case 'leave': openSheet('leave'); break;
      case 'confirm-cancel': openSheet('cancel'); break;
      case 'send-cancel': if (await act('portal_request', { p_kind: 'cancel', p_details: val('cxNote') || 'Cancel membership' }, 'Request received. We\'ll be in touch.', el)) { closeSheet(); render(); } break;
      case 'personalize': openSheet('personalize'); break;
      case 'bg': S.previewBg = el.dataset.k; applyBackground(); document.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-pressed', s === el)); break;
      case 'save-personalize': {
        const patch = { home_name: val('hn') }; if (S.previewBg) patch.background = S.previewBg;
        const keep = S.previewBg; S.previewBg = null;
        if (await act('portal_update_profile', { p_patch: patch }, 'Saved', el)) { closeSheet(); render(); } else { S.previewBg = keep; }
        break;
      }
      case 'edit-gtk': openSheet('gtk'); break;
      case 'save-gtk': if (await act('portal_update_profile', { p_patch: { good_to_know: val('gtk') } }, 'Saved', el)) { closeSheet(); render(); } break;
      case 'edit-prefs': openSheet('prefs'); break;
      case 'save-prefs': if (await act('portal_update_profile', { p_patch: { scent: val('pScent'), linens: val('pLinens'), sensitivities: val('pSens'), leave_alone: val('pLeave') } }, 'Saved', el)) { closeSheet(); render(); } break;
      case 'note-done': if (await act('portal_resolve_note', { p_note_id: id }, 'Marked as taken care of', el)) render(); break;
      case 'suggest': openSheet('messages'); setTimeout(() => { const i = $('msgIn'); if (i) { i.value = 'I\'d like to update my home details: '; i.focus(); } }, 60); break;
      case 'share-link': {
        const url = location.origin + '/h/' + token;
        try { if (navigator.share) { await navigator.share({ title: 'Our Alora home', url }); break; } } catch (_) { break; }
        try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (_) { prompt('Copy your link', url); }
        break;
      }
      case 'refer': {
        const s = D().settings || {}, url = s.referral_url;
        try { if (navigator.share) { await navigator.share({ title: 'Alora', text: s.referral_offer || '', url }); break; } } catch (_) { break; }
        try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch (_) { prompt('Copy your invite link', url); }
        break;
      }
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (sheetOpen()) closeSheet(); hideSplash(); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'msgIn') { e.preventDefault(); const b = document.querySelector('[data-act="send-msg"]'); if (b) b.click(); }
  });

  // ---------- splash ----------
  let splashDone = false, splashMin = false;
  function hideSplash() { if (splashDone) return; splashDone = true; $('splash').classList.add('out'); setTimeout(() => { $('splash').hidden = true; }, 900); }
  function maybeHideSplash() { if (splashMin && !S.loading) hideSplash(); }
  function startSplash() {
    const seen = A.store.get('alora:intro-seen');
    const dur = seen ? 1500 : 3000;
    A.store.set('alora:intro-seen', 1);
    const sp = $('splash'); sp.style.setProperty('--dur', dur + 'ms');
    requestAnimationFrame(() => sp.classList.add('go'));
    setTimeout(() => { splashMin = true; maybeHideSplash(); }, dur);
    setTimeout(hideSplash, 9000); // never get stuck on the intro
    sp.addEventListener('click', hideSplash);
    $('skipBtn').addEventListener('click', e => { e.stopPropagation(); hideSplash(); });
  }
  function personalizeSplash() {
    if (!S.data) return;
    const v = D().next_visit;
    if (v && v.status === 'on_the_way') { $('splashTitle').textContent = 'Your team is on the way'; $('splashSub').textContent = teamNames(D().team) + '.'; }
    else $('splashTitle').textContent = `Welcome home, ${firstName()}`;
  }

  // ---------- boot ----------
  const cached = token ? A.store.get(CACHE_KEY) : null;
  if (cached && cached.customer) { S.data = cached; applyBackground(); S.loading = false; personalizeSplash(); }
  startSplash(); render();
  load().then(() => { personalizeSplash(); maybeHideSplash(); });
})();
