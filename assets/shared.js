// Shared helpers for the client app and the admin app.
(function () {
  const pad = n => String(n).padStart(2, '0');
  const A = {};

  A.parseDate = s => { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  A.isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  A.today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  A.addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  A.daysBetween = (a, b) => Math.round((b - a) / 864e5);
  A.fmt = (d, o) => d ? d.toLocaleDateString('en-US', o) : '';
  A.short = d => A.fmt(d, { month: 'short', day: 'numeric' });
  A.long = d => A.fmt(d, { weekday: 'long', month: 'long', day: 'numeric' });
  A.time = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  A.money = n => n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  A.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  A.cadenceLabel = d => d === 7 ? 'Every week' : d === 14 ? 'Every 2 weeks' : d === 21 ? 'Every 3 weeks' : d === 28 ? 'Every 4 weeks' : `Every ${d} days`;

  // When an area is next due for extra attention
  A.dueDate = a => a.last_done ? A.addDays(A.parseDate(a.last_done), a.interval_days || 60) : new Date(2000, 0, 1);

  // The rotation: the next visit uses the priorities you or the client picked;
  // otherwise the areas that have waited longest. Later visits are projected.
  A.planPriorities = (areas, visit, cadenceDays, perVisit) => {
    perVisit = perVisit || 2;
    if (!visit || !areas || !areas.length) return [];
    const sorted = [...areas].sort((a, b) => A.dueDate(a) - A.dueDate(b) || String(a.name).localeCompare(b.name));
    const pinned = (visit.priorities || []).map(id => areas.find(a => a.id === id)).filter(Boolean);
    const first = pinned.length ? pinned : sorted.slice(0, perVisit);
    const rest = sorted.filter(a => !first.includes(a));
    const start = A.parseDate(visit.scheduled_date);
    const groups = [{ date: start, areas: first, isNext: true, pinned: pinned.length > 0 }];
    for (let k = 1; rest.length && k < 30; k++) groups.push({ date: A.addDays(start, (cadenceDays || 14) * k), areas: rest.splice(0, perVisit) });
    return groups;
  };

  A.greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

  // Friendly text for errors coming back from the database
  A.errorText = code => ({
    invalid_link: 'This link is no longer active.',
    visit_locked: 'This visit is already underway, so priorities can no longer change.',
    touchup_closed: 'The touch-up window for this visit has closed. Send us a message instead.',
    touchup_exists: 'You already asked for a touch-up on this visit.',
    rate_limited: 'That was a lot at once. Please wait a moment and try again.',
    bad_request: 'Something in that request was not valid.',
    not_found: 'That item could not be found. Try refreshing.',
    not_authorized: 'Your account does not have access to this.',
    offline: 'You seem to be offline. Check your connection and try again.',
  }[code] || 'Something went wrong. Please try again.');

  // Shrink photos before upload so they load fast everywhere
  A.compressImage = async (file, max = 1800, quality = 0.82) => {
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
      return blob || file;
    } catch (_) { return file; }
  };

  A.store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } },
  };

  window.Alora = A;
})();
