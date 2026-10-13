'use strict';
const VER = 'jana-v1';
const SHELL = ['/', '/style.css', '/app.js', '/admin.js', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || req.headers.has('range')) return;
  // الخطوط من جوجل: كاش أولًا
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(caches.open(VER).then(async (c) => { const m = await c.match(req); if (m) return m; try { const r = await fetch(req); c.put(req, r.clone()); return r; } catch { return Response.error(); } }));
    return;
  }
  if (url.origin !== location.origin) return;
  // واجهة برمجة التطبيقات: الشبكة أولًا ثم الكاش للمحتوى العام فقط
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/config' || url.pathname === '/api/content') {
      e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(VER).then((c) => c.put(req, cp)); return r; }).catch(() => caches.match(req)));
    }
    return;
  }
  // الملفات المرفوعة (صوت/صور): كاش عند الاستخدام
  if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(caches.open(VER).then(async (c) => { const m = await c.match(req); if (m) return m; const r = await fetch(req); if (r.ok && r.status === 200) c.put(req, r.clone()); return r; }));
    return;
  }
  // التنقل: الشبكة أولًا ثم الصفحة المخزنة
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  // بقية الأصول: stale-while-revalidate
  e.respondWith(caches.open(VER).then(async (c) => {
    const m = await c.match(req);
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => m);
    return m || net;
  }));
});
