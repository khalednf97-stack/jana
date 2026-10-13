'use strict';
/* جنى — تطبيق ويب تقدمي (PWA). كل النصوص تُدرج عبر textContent لمنع حقن HTML. */

// ============ أدوات ============
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}
const nf = (n) => Number(n).toLocaleString('ar-EG');
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dkey(new Date());
const pkey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
const hijri = (d = new Date()) => { try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch { return ''; } };
const greg = (d = new Date()) => new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);

// ============ الحالة ============
const S = {
  config: lsGet('jana.config', null),
  content: lsGet('jana.content', []),
  token: lsGet('jana.token', null),
  user: lsGet('jana.user', null),
  data: {}, upd: {}, dirty: new Set(),
  prefs: { dark: 'auto', sound: true, vibrate: true, rate: 0.85, tsize: 1 },
};
const DEFAULT_THEME = { bg: '#fde4c3', surface: '#fff4e3', card: '#fffaf1', primary: '#2f9e92', primaryText: '#ffffff', accent: '#e8909a', gold: '#c99a2e', text: '#3a2a1a', muted: '#8a7560', border: '#f0cf9f' };

function loadLocalData() {
  const d = lsGet('jana.d.' + (S.user ? S.user.id : 0), { data: {}, upd: {}, dirty: [] });
  S.data = d.data || {}; S.upd = d.upd || {}; S.dirty = new Set(d.dirty || []);
  S.prefs = { ...S.prefs, ...(S.data.prefs || {}), ...lsGet('jana.prefs', {}) };
}
function persistLocal() { if (S.user) lsSet('jana.d.' + S.user.id, { data: S.data, upd: S.upd, dirty: [...S.dirty] }); }

// ============ API ============
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let r;
  try { r = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body }); }
  catch { throw new Error('تعذّر الاتصال بالإنترنت'); }
  if (opts.body instanceof FormData) { /* المتصفح يضبط الـ boundary */ }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token && !path.startsWith('/api/auth')) { logout(true); throw new Error(j.error || 'انتهت الجلسة'); }
  if (!r.ok) throw new Error(j.error || 'حدث خطأ');
  return j;
}
const apiForm = (path, fd) => fetch(path, { method: 'POST', headers: { Authorization: 'Bearer ' + S.token }, body: fd })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'فشل الرفع'); return j; });

// ============ المزامنة (الويب ↔ الجوال) ============
let pushT;
function saveData(key) {
  S.data[key] = S.data[key]; S.upd[key] = Date.now(); S.dirty.add(key); persistLocal();
  clearTimeout(pushT); pushT = setTimeout(flush, 700);
}
async function flush() {
  if (!S.token || !navigator.onLine) return;
  for (const key of [...S.dirty]) {
    try { const r = await api('/api/me/data/' + key, { method: 'PUT', body: { value: S.data[key] } }); S.upd[key] = r.updated; S.dirty.delete(key); }
    catch { break; }
  }
  persistLocal();
}
function mergeProgress(a = {}, b = {}) {
  const out = JSON.parse(JSON.stringify(a));
  for (const [d, cats] of Object.entries(b)) for (const [c, items] of Object.entries(cats)) for (const [i, n] of Object.entries(items)) {
    const o = ((out[d] ||= {})[c] ||= {});
    o[i] = Math.max(o[i] || 0, n);
  }
  return out;
}
function mergeTasks(a = [], b = []) {
  const m = new Map();
  for (const t of [...a, ...b]) { const o = m.get(t.id); if (!o || (t.u || 0) > (o.u || 0)) m.set(t.id, t); }
  return [...m.values()];
}
async function pull() {
  if (!S.token || !navigator.onLine) return false;
  let changed = false;
  try {
    const r = await api('/api/me/data');
    for (const [k, srv] of Object.entries(r)) {
      const loc = S.data[k];
      if (k === 'progress' || k === 'study') {
        const merged = mergeProgress(loc, srv.value);
        if (JSON.stringify(merged) !== JSON.stringify(loc)) changed = true;
        S.data[k] = merged; S.upd[k] = Math.max(S.upd[k] || 0, srv.updated);
        if (JSON.stringify(merged) !== JSON.stringify(srv.value)) S.dirty.add(k);
      } else if (k === 'tasks') {
        const merged = mergeTasks(loc, srv.value);
        if (JSON.stringify(merged) !== JSON.stringify(loc)) changed = true;
        S.data[k] = merged; S.upd[k] = Math.max(S.upd[k] || 0, srv.updated);
        if (JSON.stringify(merged) !== JSON.stringify(srv.value)) S.dirty.add(k);
      } else if (srv.updated > (S.upd[k] || 0)) {
        S.data[k] = srv.value; S.upd[k] = srv.updated; changed = true;
        if (k === 'prefs') S.prefs = { ...S.prefs, ...srv.value };
      } else if ((S.upd[k] || 0) > srv.updated) S.dirty.add(k);
    }
    for (const k of Object.keys(S.data)) if (!(k in r)) S.dirty.add(k);
    persistLocal(); await flush();
  } catch {}
  return changed;
}

// ============ المحتوى والمظهر ============
async function loadPublic() {
  try {
    const [c, ct] = await Promise.all([api('/api/config'), api('/api/content')]);
    S.config = c; S.content = ct; lsSet('jana.config', c); lsSet('jana.content', ct);
  } catch {}
}
const CFG = () => S.config || { appName: 'جنى', tagline: '', welcome: '', sections: { journey: true, adhkar: true, student: true, tasbih: true, calendar: true }, themeLight: DEFAULT_THEME, themeDark: DEFAULT_THEME, fonts: { ui: 'Tajawal', text: 'Amiri' }, radius: 18, fontScale: 1, pattern: true, contact: {}, studyTips: [] };
function isDark() { return S.prefs.dark === 'on' || (S.prefs.dark === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); }
function applyTheme(cfg = CFG(), override) {
  const t = override || (isDark() ? cfg.themeDark : cfg.themeLight) || DEFAULT_THEME;
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(t)) r.setProperty('--' + k, v);
  r.setProperty('--radius', (cfg.radius ?? 18) + 'px');
  r.setProperty('--scale', cfg.fontScale || 1);
  const f = cfg.fonts || {};
  r.setProperty('--font-ui', `'${f.ui || 'Tajawal'}',system-ui,sans-serif`);
  r.setProperty('--font-text', `'${f.text || 'Amiri'}','Traditional Arabic',serif`);
  const fam = [...new Set([f.ui || 'Tajawal', f.text || 'Amiri'])].map((x) => 'family=' + x.replace(/ /g, '+') + ':wght@400;500;700;800').join('&');
  const link = $('#gfonts'); const href = `https://fonts.googleapis.com/css2?${fam}&display=swap`;
  if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
  document.body.classList.toggle('pattern', cfg.pattern !== false);
  const m = $('meta[name=theme-color]'); if (m) m.content = t.primary;
  document.title = (cfg.appName || 'جنى') + ' — حصن المسلم';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

// ============ الصوت ============
let actx;
function tone(freq, dur, type = 'sine', vol = 0.12, when = 0) {
  if (!S.prefs.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    const t0 = actx.currentTime + when;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  } catch {}
}
const sfx = {
  tick: () => tone(880, 0.07, 'triangle', 0.1),
  done: () => { tone(660, 0.18, 'sine', 0.14); tone(880, 0.22, 'sine', 0.14, 0.14); },
  all: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'sine', 0.14, i * 0.14)),
};
const vib = (p) => { if (S.prefs.vibrate && navigator.vibrate) try { navigator.vibrate(p); } catch {} };

let curAudio = null, speaking = false;
function stopSpeech() {
  speaking = false;
  try { speechSynthesis.cancel(); } catch {}
  if (curAudio) { curAudio.pause(); curAudio = null; }
}
const clean = (t) => t.replace(/﴿[^﴾]*﴾/g, ' ').replace(/[ۖ-ۭ]/g, '').replace(/ﷺ/g, 'صلى الله عليه وسلم').replace(/\s+/g, ' ').trim();
function arVoice() { try { return speechSynthesis.getVoices().find((v) => /^ar/i.test(v.lang)); } catch { return null; } }
function speak(item) {
  stopSpeech();
  return new Promise((resolve) => {
    speaking = true;
    if (item.audio_url) {
      const a = new Audio(item.audio_url); curAudio = a;
      a.onended = () => resolve(true); a.onerror = () => { toast('تعذّر تشغيل الملف الصوتي'); resolve(false); };
      a.play().catch(() => resolve(false)); return;
    }
    if (!('speechSynthesis' in window)) { toast('القراءة الصوتية غير مدعومة في هذا المتصفح'); return resolve(false); }
    const u = new SpeechSynthesisUtterance(clean(item.text));
    u.lang = 'ar-SA'; u.rate = S.prefs.rate || 0.85;
    const v = arVoice(); if (v) u.voice = v; else if (!speechSynthesis.getVoices().length) { /* قد تُحمَّل لاحقًا */ } else toast('لم يُعثر على صوت عربي في جهازك، ثبّت صوتًا عربيًا من إعدادات الجهاز');
    u.onend = () => resolve(true); u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}
try { speechSynthesis.getVoices(); } catch {}

// ============ التقدم ============
function getCount(date, catId, itemId) { return (((S.data.progress || {})[date] || {})[catId] || {})[itemId] || 0; }
function setCount(date, catId, itemId, n) {
  const p = (S.data.progress ||= {}); ((p[date] ||= {})[catId] ||= {})[itemId] = n; saveData('progress');
}
function catProgress(cat, date) {
  let total = 0, done = 0;
  for (const it of cat.items) { total += it.count; done += Math.min(it.count, getCount(date, cat.id, it.id)); }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0, complete: total > 0 && done >= total };
}
const coreCats = () => ['morning', 'evening', 'sleep'].map((s) => S.content.find((c) => c.slug === s)).filter(Boolean);
function dayStatus(date) {
  const cs = coreCats(); if (!cs.length) return 'none';
  const ps = cs.map((c) => catProgress(c, date));
  if (ps.every((p) => p.complete)) return 'done';
  return ps.some((p) => p.done > 0) ? 'part' : 'none';
}
function streak() {
  let n = 0; const d = new Date();
  if (dayStatus(dkey(d)) !== 'done') d.setDate(d.getDate() - 1);
  while (dayStatus(dkey(d)) === 'done') { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// ============ نافذة ============
function modal(title, body, opts = {}) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } });
  const close = () => { bg.remove(); opts.onclose?.(); };
  bg.append(h('div', { class: 'modal' + (opts.left ? ' left' : '') },
    h('button', { class: 'x', 'aria-label': 'إغلاق', onclick: close }, '✕'),
    title ? h('h3', null, title) : null, body));
  document.body.append(bg);
  return close;
}

// ============ الهيكل ============
const NAV = [['#/', '🏠', 'الرئيسية'], ['#/azkar', '📿', 'الأذكار'], ['#/student', '🎓', 'الطالب'], ['#/tasbih', '🔢', 'المسبحة'], ['#/settings', '⚙️', 'الإعدادات']];
let cleanup = null;
function shell(title, content, o = {}) {
  const app = $('#app'); app.replaceChildren();
  const cls = o.wide ? ' wide-top' : '';
  app.append(
    h('div', { class: 'topbar' + cls },
      o.back ? h('button', { class: 'iconbtn', 'aria-label': 'رجوع', onclick: () => (o.back === true ? history.back() : (location.hash = o.back)) }, '➜') : h('span', { style: 'width:42px' }),
      h('h1', null, title),
      o.action || h('span', { style: 'width:42px' })),
    h('div', { class: 'wrap' + (o.wide ? ' wide' : '') }, content),
    o.nav === false ? null : h('nav', { class: 'nav' }, NAV.filter((n) => navAllowed(n[0])).map(([href, i, t]) =>
      h('a', { href, class: location.hash.split('?')[0] === href || (href !== '#/' && location.hash.startsWith(href)) ? 'on' : '' }, h('span', { class: 'i' }, i), t))));
  window.scrollTo(0, 0);
}
function navAllowed(href) {
  const s = CFG().sections || {};
  return !((href === '#/azkar' && s.adhkar === false) || (href === '#/student' && s.student === false) || (href === '#/tasbih' && s.tasbih === false));
}

// ============ الدخول والتسجيل ============
function authPage(mode) {
  const c = CFG();
  const err = h('div', { class: 'err' });
  const name = h('input', { type: 'text', autocomplete: 'name', placeholder: 'الاسم الكريم' });
  const id = h('input', { type: 'text', inputmode: 'email', autocomplete: 'username', dir: 'ltr', placeholder: 'example@mail.com أو 05xxxxxxxx' });
  const pw = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: '••••••' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '••••••' });
  const btn = h('button', { class: 'btn pink block', style: 'margin-top:18px' }, 'متابعة');
  const submit = async (e) => {
    e?.preventDefault(); err.textContent = '';
    if (mode === 'register') {
      if (!name.value.trim()) return (err.textContent = 'اكتب اسمك');
      if (pw.value !== pw2.value) return (err.textContent = 'كلمتا السر غير متطابقتين');
    }
    btn.disabled = true;
    try {
      const body = mode === 'login' ? { identifier: id.value, password: pw.value } : { name: name.value, identifier: id.value, password: pw.value };
      const r = await api('/api/auth/' + mode, { method: 'POST', body });
      await startSession(r.token, r.user);
      if (r.isNew) { welcome(r.user); }
      location.hash = '#/';
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
  btn.addEventListener('click', submit);
  const form = h('form', { onsubmit: submit },
    mode === 'register' ? [h('label', null, 'الاسم الكريم'), name] : null,
    h('label', null, 'البريد الإلكتروني / رقم الهاتف'), id,
    h('label', null, 'كلمة السر'), pw,
    mode === 'register' ? [h('label', null, 'أعد كتابة كلمة السر'), pw2] : null,
    mode === 'login' ? h('a', { href: '#', class: 'muted', style: 'display:block;margin-top:8px', onclick: (e) => { e.preventDefault(); forgot(); } }, 'نسيت كلمة السر؟') : null,
    err, btn);
  const logo = c.logoUrl || '/icons/icon-192.png';
  const reg = c.registrationOpen !== false;
  $('#app').replaceChildren(h('div', { class: 'auth' },
    h('img', { class: 'logo', src: logo, alt: '' }), h('h1', null, c.appName), h('p', { class: 'tag' }, c.tagline),
    mode === 'register' && !reg ? h('div', { class: 'card' }, 'التسجيل مغلق حاليًا.') : form,
    h('div', { class: 'switch' }, mode === 'login'
      ? (reg ? ['مستخدم جديد؟ ', h('a', { href: '#/register' }, 'أنشئ حسابًا')] : null)
      : ['لديك حساب؟ ', h('a', { href: '#/login' }, 'سجّل الدخول')])));
}
function forgot() {
  const c = CFG().contact || {};
  modal('نسيت كلمة السر؟', h('div', null, 'تواصل مع إدارة التطبيق ليعيدوا تعيين كلمة السر لحسابك.',
    c.email ? h('p', null, h('a', { href: 'mailto:' + c.email }, c.email)) : null,
    c.instagram ? h('p', null, h('a', { href: c.instagram, target: '_blank', rel: 'noopener' }, 'إنستغرام')) : null));
}
function welcome(user) {
  const msg = (CFG().welcome || 'أهلًا بك {name}').replace(/\{name\}/g, user.name);
  setTimeout(() => modal('', h('div', null, h('h3', null, 'مرحبًا بك'), msg, h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn', onclick: (e) => e.target.closest('.modal-bg').remove() }, 'متابعة')))), 300);
}
async function startSession(token, user) {
  S.token = token; S.user = user; lsSet('jana.token', token); lsSet('jana.user', user);
  loadLocalData(); applyTheme();
  await pull();
}
function logout(silent) {
  stopSpeech(); S.token = null; S.user = null; localStorage.removeItem('jana.token'); localStorage.removeItem('jana.user');
  S.data = {}; S.upd = {}; S.dirty = new Set();
  location.hash = '#/login'; if (!silent) toast('تم تسجيل الخروج');
}

// ============ الرئيسية ============
function home() {
  const c = CFG(), sec = c.sections || {}, st = streak();
  const cs = coreCats(), d = today();
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'صباح الخير' : hr < 18 ? 'مساء الخير' : 'مساء النور';
  const dayN = Math.max(1, Math.round((pkey(d) - pkey(dkey(new Date(S.user.created_at)))) / 864e5) + 1);
  const rows = cs.map((cat) => { const p = catProgress(cat, d); return h('a', { href: '#/c/' + cat.id, class: 'tile', style: 'flex-direction:row;justify-content:space-between;padding:12px 16px;margin:8px 0' },
    h('span', null, cat.icon + ' ' + cat.title), h('span', { class: 'muted' }, p.complete ? '✓ تم' : nf(p.pct) + '٪')); });
  shell(c.appName, [
    h('div', { class: 'hero' }, h('img', { class: 'logo', src: c.logoUrl || '/icons/icon-192.png', alt: '' }),
      h('div', null, h('h2', null, `${greet} يا ${S.user.name}`), h('div', { class: 'muted' }, hijri() + ' · ' + greg()))),
    c.announcement ? h('div', { class: 'banner' }, '📣 ' + c.announcement) : null,
    installBanner(),
    sec.journey !== false && cs.length ? h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'وردك اليوم'), h('span', { class: 'badge' }, '🔥 ' + nf(st) + ' يوم متتالٍ')),
      rows, h('a', { class: 'btn ghost sm', href: '#/journey' }, `رحلتي · اليوم ${nf(dayN)}`)) : null,
    h('div', { class: 'grid', style: 'margin-top:12px' },
      sec.adhkar !== false ? h('a', { class: 'tile', href: '#/azkar' }, h('span', { class: 'ic' }, '📿'), 'حصن المسلم', h('small', null, nf(S.content.length) + ' قسمًا')) : null,
      sec.student !== false ? h('a', { class: 'tile', href: '#/student' }, h('span', { class: 'ic' }, '🎓'), 'ركن الطالب', h('small', null, 'مذاكرة · مهام · أدعية')) : null,
      sec.tasbih !== false ? h('a', { class: 'tile', href: '#/tasbih' }, h('span', { class: 'ic' }, '🔢'), 'المسبحة') : null,
      sec.calendar !== false ? h('a', { class: 'tile', href: '#/calendar' }, h('span', { class: 'ic' }, '🗓️'), 'التقويم والإنجاز') : null),
  ], { action: S.user.role === 'admin' ? h('a', { class: 'iconbtn', href: '#/admin', title: 'لوحة التحكم' }, '🛠️') : null });
}

// ============ التثبيت ============
let deferredPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; if (location.hash === '' || location.hash === '#/' || location.hash === '#/settings') route(); });
addEventListener('appinstalled', () => { deferredPrompt = null; toast('تم تثبيت التطبيق 🎉'); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function installBanner() {
  if (standalone() || lsGet('jana.noinstall', false)) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!deferredPrompt && !ios) return null;
  return h('div', { class: 'card row' },
    h('div', { class: 'grow' }, h('b', null, 'ثبّت جنى على جوالك'), h('div', { class: 'muted' }, ios ? 'اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»' : 'يعمل كتطبيق مستقل وبدون إنترنت')),
    deferredPrompt ? h('button', { class: 'btn sm', onclick: doInstall }, 'تثبيت') : null,
    h('button', { class: 'iconbtn', 'aria-label': 'إخفاء', onclick: () => { lsSet('jana.noinstall', true); route(); } }, '✕'));
}
async function doInstall() { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; route(); }

// ============ الأذكار ============
function azkarList() {
  const c = CFG(); const d = today();
  const show = S.content.filter((x) => x.items.length);
  shell('حصن المسلم', [
    h('p', { class: 'muted' }, 'اضغط على القسم لقراءة الأذكار، ويُحفظ تقدمك اليومي في حسابك.'),
    h('div', { class: 'grid' }, show.map((cat) => { const p = catProgress(cat, d);
      return h('a', { class: 'tile', href: '#/c/' + cat.id }, h('span', { class: 'ic' }, cat.icon || '📿'), cat.title,
        h('small', null, p.complete ? '✓ أُنجز اليوم' : nf(cat.items.length) + ' ذكر')); })),
  ]);
}

function category(id) {
  const cat = S.content.find((c) => String(c.id) === String(id));
  if (!cat) return azkarList();
  const d = today(); let playingAll = false;
  const bar = h('i'), pct = h('span', { class: 'muted' });
  const cards = new Map();
  const upd = () => { const p = catProgress(cat, d); bar.style.width = p.pct + '%'; pct.textContent = `${nf(p.done)} / ${nf(p.total)} · ${nf(p.pct)}٪`; };
  const setTsize = (v) => { S.prefs.tsize = Math.min(1.6, Math.max(0.8, v)); savePrefs(); document.documentElement.style.setProperty('--tsz', S.prefs.tsize); };
  document.documentElement.style.setProperty('--tsz', S.prefs.tsize || 1);

  const makeCard = (it, idx) => {
    const txt = h('p', { class: 'txt', style: 'font-size:calc(1.55rem*var(--tsz,1))' }, it.text);
    const ctr = h('button', { class: 'counter', 'aria-label': 'عدّاد' }, h('span'));
    const card = h('div', { class: 'zekr', id: 'z' + it.id });
    const paint = () => {
      const n = Math.min(it.count, getCount(d, cat.id, it.id));
      ctr.style.setProperty('--p', (n / it.count) * 100);
      ctr.firstChild.textContent = it.count === 1 ? (n ? '✓' : '1') : nf(it.count - n);
      ctr.classList.toggle('done', n >= it.count); card.classList.toggle('done', n >= it.count);
    };
    ctr.addEventListener('click', () => {
      const n = getCount(d, cat.id, it.id); if (n >= it.count) return;
      setCount(d, cat.id, it.id, n + 1); paint(); upd();
      if (n + 1 >= it.count) {
        sfx.done(); vib([30, 40, 30]);
        const p = catProgress(cat, d);
        if (p.complete) { sfx.all(); vib([60, 40, 60, 40, 120]); finished(); }
        else { const next = cat.items.find((x) => getCount(d, cat.id, x.id) < x.count); if (next) setTimeout(() => cards.get(next.id)?.card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350); }
      } else { sfx.tick(); vib(12); }
    });
    const play = h('button', { class: 'iconbtn', title: 'استماع', 'aria-label': 'استماع', onclick: async () => {
      if (card.classList.contains('playing')) { stopSpeech(); card.classList.remove('playing'); return; }
      document.querySelectorAll('.zekr.playing').forEach((e) => e.classList.remove('playing'));
      card.classList.add('playing'); await speak(it); card.classList.remove('playing');
    } }, '🔊');
    const copy = h('button', { class: 'iconbtn', title: 'نسخ/مشاركة', 'aria-label': 'مشاركة', onclick: async () => {
      const t = it.text + (it.source ? `\n(${it.source})` : '') + `\n— ${CFG().appName}`;
      try { if (navigator.share) await navigator.share({ text: t }); else { await navigator.clipboard.writeText(t); toast('تم النسخ'); } } catch {}
    } }, '📋');
    card.append(txt,
      it.virtue ? h('div', { class: 'virtue' }, '✨ ' + it.virtue) : null,
      h('div', { class: 'meta' }, h('div', { class: 'src' }, it.source ? '📖 ' + it.source : '', it.count > 1 ? h('div', null, 'التكرار: ' + nf(it.count) + ' مرة') : null),
        h('div', { class: 'row' }, h('div', { class: 'zactions' }, play, copy), ctr)));
    paint(); cards.set(it.id, { card, paint, it });
    return card;
  };
  const list = h('div', null, cat.items.map(makeCard));
  const finished = () => {
    modal('', h('div', null, h('div', { style: 'font-size:3rem' }, '🌟'), h('h3', null, 'تقبّل الله منك يا ' + S.user.name),
      `أتممت «${cat.title}» اليوم.`, h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: (e) => { e.target.closest('.modal-bg').remove(); location.hash = '#/'; } }, 'الرئيسية'))));
  };
  const playAll = async () => {
    if (playingAll) { playingAll = false; stopSpeech(); document.querySelectorAll('.zekr.playing').forEach((e) => e.classList.remove('playing')); pa.textContent = '▶ استماع للكل'; return; }
    playingAll = true; pa.textContent = '⏹ إيقاف';
    for (const it of cat.items) {
      if (!playingAll) break;
      const c = cards.get(it.id); c.card.classList.add('playing'); c.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const ok = await speak(it); c.card.classList.remove('playing'); if (!ok && !playingAll) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    playingAll = false; pa.textContent = '▶ استماع للكل';
  };
  const pa = h('button', { class: 'chip', onclick: playAll }, '▶ استماع للكل');
  shell(cat.title, [
    h('div', { class: 'progress' }, bar), h('div', { class: 'row' }, pct),
    h('div', { class: 'tools' }, pa,
      h('button', { class: 'chip', onclick: () => setTsize((S.prefs.tsize || 1) + 0.1) }, 'أ+'),
      h('button', { class: 'chip', onclick: () => setTsize((S.prefs.tsize || 1) - 0.1) }, 'أ−'),
      h('button', { class: 'chip', onclick: () => { if (!confirm('إعادة تصفير عدّادات هذا القسم لليوم؟')) return; cat.items.forEach((i) => setCount(d, cat.id, i.id, 0)); cards.forEach((c) => c.paint()); upd(); } }, '↺ تصفير')),
    list,
  ], { back: true });
  upd();
  cleanup = () => { playingAll = false; stopSpeech(); };
}

// ============ رحلة الأيام ============
function journey() {
  const created = pkey(dkey(new Date(S.user.created_at)));
  const now = pkey(today());
  const idx = Math.round((now - created) / 864e5); // 0-based
  const per = 14, cycle = Math.floor(idx / per), base = cycle * per;
  const rows = [];
  for (let i = 0; i < per; i++) {
    const di = base + i; const date = new Date(created); date.setDate(date.getDate() + di); const k = dkey(date);
    const state = di > idx ? 'locked' : di === idx ? 'today' : dayStatus(k) === 'done' ? 'done' : 'past';
    const x = 50 + 34 * Math.sin(i * 0.85);
    const done = dayStatus(k) === 'done';
    const btn = h('button', { class: 'node ' + (done ? 'done ' : '') + (state === 'today' ? 'today ' : '') + (state === 'locked' ? 'locked' : ''), 'aria-label': 'اليوم ' + (di + 1),
      onclick: () => dayModal(di + 1, k, state) }, done ? '✓' : nf(di + 1));
    rows.push(h('div', { class: 'nrow', style: `padding-inline-start:calc(${x}% - 25px)` }, btn));
  }
  shell('رحلتي مع الأذكار', [
    h('p', { class: 'muted' }, 'كل يوم تُنجز فيه أذكار الصباح والمساء والنوم يُضاء بالأخضر ✓. حافظ على سلسلتك المتتالية!'),
    h('div', { class: 'card' }, h('b', null, `🔥 ${nf(streak())} يوم متتالٍ`)),
    h('div', { class: 'journey' }, h('div', { class: 'path' }, rows)),
  ], { back: '#/' });
}
function dayModal(n, date, state) {
  if (state === 'locked') return modal('', h('div', null, `اليوم ${nf(n)} سيُفتح في موعده بإذن الله 🌙`));
  const cs = coreCats();
  const close = modal(`اليوم ${nf(n)}`, h('div', null, cs.map((cat) => { const p = catProgress(cat, date);
    return h('div', { class: 'row', style: 'margin:8px 0;justify-content:space-between' }, h('span', null, (p.complete ? '✅ ' : '⬜ ') + cat.title),
      state === 'today' ? h('a', { class: 'btn sm', href: '#/c/' + cat.id, onclick: () => close() }, 'ابدأ') : h('span', { class: 'muted' }, nf(p.pct) + '٪')); }),
    state === 'today' ? h('p', { class: 'muted' }, 'عند إنجاز المهام كلها يُسجَّل اليوم ✓') : null), { left: true });
}

// ============ التقويم ============
let calMonth = null;
function calendar() {
  const now = new Date(); calMonth ||= new Date(now.getFullYear(), now.getMonth(), 1);
  const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
  const days = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const names = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج']; // السبت أولًا
  const off = (first.getDay() + 1) % 7;
  const cells = [...names.map((n) => h('b', null, n)), ...Array(off).fill(0).map(() => h('span', { style: 'background:none' }))];
  for (let i = 1; i <= days; i++) {
    const dt = new Date(calMonth.getFullYear(), calMonth.getMonth(), i); const k = dkey(dt); const s = dayStatus(k);
    cells.push(h('span', { class: (s === 'done' ? 'ok ' : s === 'part' ? 'part ' : '') + (k === today() ? 'today' : ''), title: hijri(dt), onclick: () => toast(hijri(dt) + ' — ' + (s === 'done' ? 'أُنجز الورد ✓' : s === 'part' ? 'إنجاز جزئي' : 'لا إنجاز')) }, nf(i)));
  }
  const mn = new Intl.DateTimeFormat('ar', { month: 'long', year: 'numeric' }).format(calMonth);
  const hm = hijri(calMonth > now ? calMonth : now);
  shell('التقويم والإنجاز', [
    h('div', { class: 'card' }, h('div', { class: 'row' },
      h('button', { class: 'iconbtn', onclick: () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); calendar(); } }, '▶'),
      h('div', { class: 'grow', style: 'text-align:center' }, h('b', null, mn), h('div', { class: 'muted' }, 'اليوم: ' + hijri())),
      h('button', { class: 'iconbtn', onclick: () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); calendar(); } }, '◀')),
      h('div', { class: 'cal', style: 'margin-top:12px' }, cells)),
    h('p', { class: 'muted' }, 'الأخضر الكامل = أنجزت الصباح والمساء والنوم. اضغط على اليوم لترى تاريخه الهجري.'),
  ], { back: '#/' });
}

// ============ المسبحة ============
const TASBIH = ['سبحان الله', 'الحمد لله', 'الله أكبر', 'لا إله إلا الله', 'أستغفر الله', 'اللهم صل وسلم على نبينا محمد', 'لا حول ولا قوة إلا بالله', 'سبحان الله وبحمده'];
function tasbih() {
  const d = today(); const T = (S.data.tasbih ||= { cur: 0, target: 33, counts: {} });
  const phrase = () => TASBIH[T.cur] || TASBIH[0];
  const rec = () => ((T.counts[phrase()] ||= { total: 0, day: d, today: 0 }));
  const num = h('div'); const info = h('div', { class: 'muted', style: 'text-align:center' });
  const btn = h('button', { class: 'tasbih-btn', 'aria-label': 'سبّح' }, num);
  const paint = () => {
    const r = rec(); if (r.day !== d) { r.day = d; r.today = 0; }
    const session = (T.session || 0);
    num.textContent = nf(session);
    info.textContent = `اليوم: ${nf(r.today)} · الإجمالي: ${nf(r.total)}` + (T.target ? ` · الهدف ${nf(T.target)}` : '');
  };
  btn.addEventListener('click', () => {
    const r = rec(); if (r.day !== d) { r.day = d; r.today = 0; }
    T.session = (T.session || 0) + 1; r.total++; r.today++; saveData('tasbih'); paint();
    if (T.target && T.session % T.target === 0) { sfx.done(); vib([50, 40, 50]); toast('أتممت ' + nf(T.target) + ' ✓'); } else { sfx.tick(); vib(10); }
  });
  const sel = h('select', { onchange: () => { T.cur = +sel.value; T.session = 0; saveData('tasbih'); tasbih(); } },
    TASBIH.map((t, i) => h('option', { value: i, selected: i === T.cur }, t)));
  shell('المسبحة', [
    h('div', { class: 'card' }, h('label', { style: 'margin-top:0' }, 'الذكر'), sel,
      h('div', { class: 'tools' }, [33, 100, 0].map((n) => h('button', { class: 'chip' + ((T.target || 0) === n ? ' on' : ''), onclick: () => { T.target = n; saveData('tasbih'); tasbih(); } }, n ? 'الهدف ' + nf(n) : 'بلا هدف')))),
    h('div', { class: 'txt', style: 'font-family:var(--font-text);font-size:1.8rem;text-align:center;margin-top:10px' }, phrase()),
    h('div', { style: 'display:grid;place-items:center' }, btn), info,
    h('div', { style: 'text-align:center;margin-top:14px' }, h('button', { class: 'btn ghost sm', onclick: () => { T.session = 0; saveData('tasbih'); paint(); } }, '↺ تصفير الجلسة')),
  ]);
  paint();
}

// ============ ركن الطالب ============
function student() {
  const c = CFG(); const tips = c.studyTips || [];
  const tip = tips.length ? tips[Math.floor(new Date().getTime() / 864e5) % tips.length] : '';
  const sc = S.content.filter((x) => x.audience === 'student' && x.items.length);
  const tasks = (S.data.tasks || []).filter((t) => !t.d && !t.done).length;
  const mins = ((S.data.study || {})[today()] || {}).m || 0;
  shell('ركن الطالب', [
    tip ? h('div', { class: 'banner' }, '💡 ' + tip) : null,
    h('div', { class: 'grid' },
      ...sc.map((cat) => h('a', { class: 'tile', href: '#/c/' + cat.id }, h('span', { class: 'ic' }, cat.icon || '📚'), cat.title, h('small', null, nf(cat.items.length) + ' دعاء'))),
      h('a', { class: 'tile', href: '#/timer' }, h('span', { class: 'ic' }, '⏱️'), 'مؤقت المذاكرة', h('small', null, 'اليوم: ' + nf(mins) + ' دقيقة')),
      h('a', { class: 'tile', href: '#/tasks' }, h('span', { class: 'ic' }, '📝'), 'مهامي وواجباتي', h('small', null, nf(tasks) + ' متبقية'))),
    h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', null, 'قبل أن تبدأ المذاكرة'),
      h('p', { class: 'muted' }, 'بسملة، ثم: «رَبِّ زِدْنِي عِلْمًا»، ثم ركّز على مادة واحدة لمدة 25 دقيقة.'),
      h('a', { class: 'btn sm', href: '#/timer' }, 'ابدأ جلسة مذاكرة')),
    tips.length ? h('div', { class: 'card' }, h('h3', null, 'نصائح للطالب'), h('ul', { style: 'padding-inline-start:20px;margin:0' }, tips.map((t) => h('li', null, t)))) : null,
  ]);
}

function timer() {
  const st = (window.__timer ||= { mode: 'focus', focus: 25, brk: 5, end: 0, left: 25 * 60, running: false });
  let iv = null, wake = null;
  const disp = h('div', { style: 'font-size:4.5rem;font-weight:800;text-align:center;font-variant-numeric:tabular-nums;direction:ltr' });
  const label = h('div', { class: 'muted', style: 'text-align:center;font-size:1.1rem' });
  const startBtn = h('button', { class: 'btn' });
  const fmt = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  const paint = () => {
    disp.textContent = fmt(Math.max(0, st.left));
    label.textContent = st.mode === 'focus' ? '🎯 وقت التركيز' : '☕ استراحة';
    startBtn.textContent = st.running ? '⏸ إيقاف مؤقت' : '▶ ابدأ';
  };
  const tick = () => {
    st.left = Math.max(0, Math.round((st.end - Date.now()) / 1000)); paint();
    if (st.left <= 0) done();
  };
  const done = () => {
    clearInterval(iv); st.running = false; sfx.all(); vib([200, 100, 200]);
    if (st.mode === 'focus') {
      const s = (S.data.study ||= {}); const k = today(); (s[k] ||= { m: 0 }).m += st.focus; saveData('study');
      st.mode = 'break'; st.left = st.brk * 60;
      modal('أحسنت يا ' + S.user.name + ' 🌟', h('div', null, `أتممت ${nf(st.focus)} دقيقة تركيز.\nقل: «الحمد لله»، وخذ استراحة قصيرة.`));
    } else { st.mode = 'focus'; st.left = st.focus * 60; toast('انتهت الاستراحة، هيا نكمل بإذن الله'); }
    paint(); release();
  };
  const release = () => { try { wake?.release(); } catch {} wake = null; };
  startBtn.addEventListener('click', async () => {
    if (st.running) { st.running = false; clearInterval(iv); release(); }
    else { st.running = true; st.end = Date.now() + st.left * 1000; iv = setInterval(tick, 500); try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
    paint();
  });
  const setLen = (kind, v) => { st[kind] = Math.min(180, Math.max(1, v)); if (!st.running && ((kind === 'focus' && st.mode === 'focus') || (kind === 'brk' && st.mode === 'break'))) st.left = st[kind] * 60; timer(); };
  const num = (kind, title) => h('div', { class: 'row', style: 'justify-content:space-between;margin:6px 0' }, h('span', null, title),
    h('div', { class: 'row' }, h('button', { class: 'iconbtn', onclick: () => setLen(kind, st[kind] - 5) }, '−'), h('b', null, nf(st[kind]) + ' د'), h('button', { class: 'iconbtn', onclick: () => setLen(kind, st[kind] + 5) }, '+')));
  const mins = ((S.data.study || {})[today()] || {}).m || 0;
  shell('مؤقت المذاكرة', [
    h('div', { class: 'card' }, label, disp, h('div', { style: 'text-align:center;margin-top:12px' }, startBtn, ' ',
      h('button', { class: 'btn ghost', onclick: () => { clearInterval(iv); st.running = false; st.mode = 'focus'; st.left = st.focus * 60; release(); timer(); } }, '↺'))),
    h('div', { class: 'card' }, num('focus', 'مدة التركيز'), num('brk', 'مدة الاستراحة')),
    h('div', { class: 'card' }, '📊 مذاكرتك اليوم: ', h('b', null, nf(mins) + ' دقيقة')),
    h('div', { class: 'card' }, h('b', null, 'قبل الجلسة: '), '«بسم الله، رَبِّ زِدْنِي عِلْمًا»'),
  ], { back: '#/student' });
  paint(); if (st.running) { iv = setInterval(tick, 500); tick(); }
  cleanup = () => { clearInterval(iv); release(); };
}

function tasks() {
  const list = () => (S.data.tasks ||= []);
  const title = h('input', { type: 'text', placeholder: 'مثال: حل واجب الرياضيات', maxlength: 120 });
  const subj = h('input', { type: 'text', placeholder: 'المادة (اختياري)', maxlength: 40 });
  const due = h('input', { type: 'date' });
  const box = h('div');
  const add = () => {
    if (!title.value.trim()) return toast('اكتب المهمة');
    list().push({ id: Math.random().toString(36).slice(2, 10), t: title.value.trim(), s: subj.value.trim(), due: due.value, done: false, u: Date.now() });
    saveData('tasks'); title.value = ''; subj.value = ''; due.value = ''; paint();
  };
  const paint = () => {
    const ts = list().filter((t) => !t.d).sort((a, b) => (a.done - b.done) || ((a.due || '9') > (b.due || '9') ? 1 : -1));
    box.replaceChildren(...(ts.length ? ts.map((t) => h('label', { style: t.done ? 'opacity:.55' : '' },
      h('input', { type: 'checkbox', checked: t.done, onchange: (e) => { t.done = e.target.checked; t.u = Date.now(); saveData('tasks'); if (t.done) { sfx.done(); vib(20); } paint(); } }),
      h('span', { class: 'grow', style: t.done ? 'text-decoration:line-through' : '' }, t.t, t.s ? h('span', { class: 'badge', style: 'margin-inline-start:8px' }, t.s) : null,
        t.due ? h('div', { class: 'muted', style: t.due < today() && !t.done ? 'color:#c0392b' : '' }, '📅 ' + t.due) : null),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'حذف', onclick: (e) => { e.preventDefault(); t.d = true; t.u = Date.now(); saveData('tasks'); paint(); } }, '🗑️'))) : [h('p', { class: 'muted' }, 'لا مهام بعد. أضف أول مهمة 👆')]));
  };
  shell('مهامي وواجباتي', [
    h('div', { class: 'card' }, title, h('div', { class: 'row', style: 'margin-top:8px' }, subj, due), h('button', { class: 'btn block', style: 'margin-top:10px', onclick: add }, '+ إضافة')),
    h('div', { class: 'card tasks-list' }, box)], { back: '#/student' });
  paint();
}

// ============ الإعدادات ============
function savePrefs() { S.data.prefs = { ...S.prefs }; lsSet('jana.prefs', S.prefs); saveData('prefs'); }
function settings() {
  const c = CFG(), ct = c.contact || {};
  const sw = (key, label) => { const b = h('button', { class: 'sw' + (S.prefs[key] ? ' on' : ''), role: 'switch', 'aria-checked': !!S.prefs[key], 'aria-label': label,
    onclick: () => { S.prefs[key] = !S.prefs[key]; b.classList.toggle('on', S.prefs[key]); savePrefs(); } }); return h('div', { class: 'set' }, h('span', null, label), b); };
  const dark = h('select', { onchange: () => { S.prefs.dark = dark.value; savePrefs(); applyTheme(); } },
    [['auto', 'تلقائي'], ['off', 'فاتح'], ['on', 'داكن']].map(([v, t]) => h('option', { value: v, selected: S.prefs.dark === v }, t)));
  const rate = h('input', { type: 'range', min: 0.5, max: 1.3, step: 0.05, value: S.prefs.rate, onchange: () => { S.prefs.rate = +rate.value; savePrefs(); } });
  shell('الإعدادات', [
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { style: 'font-size:2.2rem' }, '👤'), h('div', { class: 'grow' }, h('b', null, S.user.name), h('div', { class: 'muted', dir: 'ltr', style: 'text-align:right' }, S.user.identifier))),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('a', { class: 'btn sm ghost', href: '#/account' }, 'إعدادات الحساب'), S.user.role === 'admin' ? h('a', { class: 'btn sm', href: '#/admin' }, '🛠️ لوحة التحكم') : null)),
    h('div', { class: 'card' }, sw('sound', 'المؤثرات الصوتية'), sw('vibrate', 'الاهتزاز عند العدّ'),
      h('div', { class: 'set' }, h('span', null, 'المظهر'), dark), h('div', { class: 'set' }, h('span', null, 'سرعة القراءة الصوتية'), rate)),
    deferredPrompt && !standalone() ? h('button', { class: 'btn block', onclick: doInstall }, '📲 تثبيت التطبيق على الجوال') : null,
    (ct.instagram || ct.youtube || ct.email || ct.website) ? h('div', { class: 'card' }, h('h3', null, 'تواصل معنا'),
      ct.instagram ? h('a', { class: 'linkrow', href: ct.instagram, target: '_blank', rel: 'noopener' }, 'إنستغرام') : null,
      ct.youtube ? h('a', { class: 'linkrow', href: ct.youtube, target: '_blank', rel: 'noopener' }, 'يوتيوب') : null,
      ct.website ? h('a', { class: 'linkrow', href: ct.website, target: '_blank', rel: 'noopener' }, 'الموقع') : null,
      ct.email ? h('a', { class: 'linkrow pink', href: 'mailto:' + ct.email }, ct.email) : null) : null,
    h('button', { class: 'btn danger block', style: 'margin-top:14px', onclick: () => logout() }, 'تسجيل خروج'),
    h('p', { class: 'muted', style: 'text-align:center;margin-top:16px' }, 'حسابك واحد على الويب والجوال، وتقدمك يُحفظ ويتزامن تلقائيًا.'),
  ]);
}
function account() {
  const err = h('div', { class: 'err' });
  const nm = h('input', { type: 'text', value: S.user.name, maxlength: 60 });
  const o = h('input', { type: 'password', autocomplete: 'current-password' }), n1 = h('input', { type: 'password', autocomplete: 'new-password' }), n2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const id = h('input', { type: 'text', value: S.user.identifier, dir: 'ltr' }), idp = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'كلمة السر الحالية للتأكيد' });
  const run = async (fn, ok) => { err.textContent = ''; try { await fn(); toast(ok); } catch (e) { err.textContent = e.message; } };
  shell('إعدادات الحساب', [
    h('div', { class: 'card' }, h('label', { style: 'margin-top:0' }, 'اسم صاحب الحساب'), nm,
      h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: () => run(async () => { const r = await api('/api/me', { method: 'PATCH', body: { name: nm.value } }); S.user = r.user; lsSet('jana.user', r.user); }, 'تم حفظ الاسم') }, 'حفظ')),
    h('div', { class: 'card' }, h('label', { style: 'margin-top:0' }, 'تغيير البريد / الهاتف'), id, idp,
      h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: () => run(async () => { const r = await api('/api/me', { method: 'PATCH', body: { identifier: id.value, password: idp.value } }); S.user = r.user; lsSet('jana.user', r.user); idp.value = ''; }, 'تم التحديث') }, 'تحديث')),
    h('div', { class: 'card' }, h('label', { style: 'margin-top:0' }, 'كلمة السر القديمة'), o, h('label', null, 'كلمة السر الجديدة'), n1, h('label', null, 'أعد كتابتها'), n2,
      h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: () => run(async () => { if (n1.value !== n2.value) throw new Error('كلمتا السر غير متطابقتين'); await api('/api/me/password', { method: 'POST', body: { oldPassword: o.value, newPassword: n1.value } }); o.value = n1.value = n2.value = ''; }, 'تم تغيير كلمة السر') }, 'تأكيد')),
    err], { back: '#/settings' });
}

// ============ الموجّه ============
async function route() {
  cleanup?.(); cleanup = null; stopSpeech();
  const parts = (location.hash.replace(/^#/, '') || '/').split('?')[0].split('/').filter(Boolean);
  const path = '/' + (parts[0] || ''), arg = parts[1];
  if (!S.token || !S.user) { if (path === '/register') return authPage('register'); return authPage('login'); }
  if (path === '/login' || path === '/register') { location.hash = '#/'; return; }
  const sec = CFG().sections || {};
  switch (path) {
    case '/': return home();
    case '/azkar': return azkarList();
    case '/c': return category(arg);
    case '/journey': return journey();
    case '/calendar': return calendar();
    case '/tasbih': return tasbih();
    case '/student': return student();
    case '/timer': return timer();
    case '/tasks': return tasks();
    case '/settings': return settings();
    case '/account': return account();
    case '/admin': {
      if (S.user.role !== 'admin') { location.hash = '#/'; return; }
      if (!window.JanaAdmin) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/admin.js'; s.onload = res; s.onerror = rej; document.head.append(s); }).catch(() => toast('تعذّر تحميل لوحة التحكم'));
      return window.JanaAdmin?.render({ api, apiForm, h, shell, toast, S, modal, applyTheme, loadPublic, CFG, nf, DEFAULT_THEME });
    }
    default: location.hash = '#/';
  }
}
addEventListener('hashchange', route);
addEventListener('online', () => { flush(); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && S.token) {
    await loadPublic(); applyTheme();
    const ch = await pull();
    if (ch && !/^#\/(timer|admin|c\/)/.test(location.hash)) route();
  }
});

// ============ الإقلاع ============
(async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (S.user) loadLocalData();
  applyTheme();
  if (!S.config) await loadPublic(); else loadPublic().then(() => { applyTheme(); });
  applyTheme();
  if (S.token) {
    try { const r = await api('/api/me'); S.user = r.user; lsSet('jana.user', r.user); loadLocalData(); }
    catch (e) { if (!S.user) S.token = null; }
    if (S.token) pull().then((ch) => { if (ch && !/^#\/(timer|admin|c\/)/.test(location.hash)) route(); });
  }
  route();
})();
