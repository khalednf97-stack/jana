'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const Database = require('better-sqlite3');
const { categories: seedCats, defaultSettings } = require('./lib/seed');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- أسرار ----------
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  const f = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(f)) JWT_SECRET = fs.readFileSync(f, 'utf8').trim();
  else { JWT_SECRET = crypto.randomBytes(48).toString('hex'); fs.writeFileSync(f, JWT_SECRET, { mode: 0o600 }); }
}

// ---------- قاعدة البيانات ----------
const db = new Database(path.join(DATA_DIR, 'jana.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  icon TEXT DEFAULT '',
  audience TEXT DEFAULT 'all',
  sort INTEGER DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS adhkar(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  source TEXT DEFAULT '',
  virtue TEXT DEFAULT '',
  audio_url TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS user_data(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY(user_id, key)
);
`);

// بذر المحتوى عند أول تشغيل
if (db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
  const insCat = db.prepare('INSERT INTO categories(slug,title,icon,audience,sort) VALUES(?,?,?,?,?)');
  const insAd = db.prepare('INSERT INTO adhkar(category_id,text,count,source,virtue,sort) VALUES(?,?,?,?,?,?)');
  db.transaction(() => {
    for (const c of seedCats) {
      const id = insCat.run(c.slug, c.title, c.icon, c.audience || 'all', c.sort).lastInsertRowid;
      c.items.forEach((it, i) => insAd.run(id, it[0], it[1], it[2] || '', it[3] || '', i));
    }
  })();
}
if (!db.prepare("SELECT 1 FROM settings WHERE key='site'").get()) {
  db.prepare("INSERT INTO settings(key,value) VALUES('site',?)").run(JSON.stringify(defaultSettings));
}

// حساب المدير الأول
function normId(s) {
  s = String(s || '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
  const d = s.replace(/[\s\-()]/g, '').replace(/^00/, '+');
  if (/^\+?\d{7,15}$/.test(d)) return d;
  return null;
}
if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
  const email = normId(process.env.ADMIN_EMAIL) || 'admin@jana.app';
  const pass = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO users(name,identifier,pass_hash,role,created_at) VALUES(?,?,?,?,?)')
    .run('المدير', email, bcrypt.hashSync(pass, 10), 'admin', Date.now());
  if (!process.env.ADMIN_PASSWORD) {
    fs.writeFileSync(path.join(DATA_DIR, 'ADMIN-LOGIN.txt'), `البريد: ${email}\nكلمة السر: ${pass}\n(غيّرها بعد أول دخول ثم احذف هذا الملف)\n`, { mode: 0o600 });
  }
  console.log('\n=== تم إنشاء حساب المدير ===');
  console.log('البريد:', email);
  console.log(process.env.ADMIN_PASSWORD ? 'كلمة السر: (من ADMIN_PASSWORD)' : 'كلمة السر: ' + pass + '  (محفوظة أيضًا في data/ADMIN-LOGIN.txt)');
  console.log('============================\n');
}

// ---------- أدوات ----------
const getSite = () => ({ ...defaultSettings, ...JSON.parse(db.prepare("SELECT value FROM settings WHERE key='site'").get().value) });
const saveSite = (s) => db.prepare("UPDATE settings SET value=? WHERE key='site'").run(JSON.stringify(s));
const publicUser = (u) => ({ id: u.id, name: u.name, identifier: u.identifier, role: u.role, created_at: u.created_at });
const sign = (u) => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '60d' });

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONTS = ['Tajawal', 'Cairo', 'Almarai', 'IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'Amiri', 'Scheherazade New', 'Noto Naskh Arabic', 'Reem Kufi', 'Lateef'];
const str = (v, max = 500) => String(v == null ? '' : v).slice(0, max);

function sanitizeSite(inp, cur) {
  const o = { ...cur };
  if ('appName' in inp) o.appName = str(inp.appName, 40) || cur.appName;
  if ('tagline' in inp) o.tagline = str(inp.tagline, 120);
  if ('welcome' in inp) o.welcome = str(inp.welcome, 600);
  if ('registrationOpen' in inp) o.registrationOpen = !!inp.registrationOpen;
  if ('announcement' in inp) o.announcement = str(inp.announcement, 300);
  if ('pattern' in inp) o.pattern = !!inp.pattern;
  if ('logoUrl' in inp) o.logoUrl = /^\/uploads\/[\w.\-]+$/.test(inp.logoUrl) ? inp.logoUrl : '';
  if ('radius' in inp) o.radius = Math.min(32, Math.max(0, parseInt(inp.radius) || 0));
  if ('fontScale' in inp) o.fontScale = Math.min(1.4, Math.max(0.8, parseFloat(inp.fontScale) || 1));
  if (inp.contact) {
    o.contact = {};
    for (const k of ['instagram', 'youtube', 'email', 'website']) o.contact[k] = str(inp.contact[k], 200);
  }
  if (inp.sections) {
    o.sections = { ...cur.sections };
    for (const k of Object.keys(cur.sections)) if (k in inp.sections) o.sections[k] = !!inp.sections[k];
  }
  if (inp.fonts) {
    o.fonts = { ...cur.fonts };
    for (const k of ['ui', 'text']) if (FONTS.includes(inp.fonts[k])) o.fonts[k] = inp.fonts[k];
  }
  if (Array.isArray(inp.studyTips)) o.studyTips = inp.studyTips.map((t) => str(t, 200)).filter(Boolean).slice(0, 30);
  for (const t of ['themeLight', 'themeDark']) {
    if (inp[t]) {
      o[t] = { ...cur[t] };
      for (const k of Object.keys(defaultSettings[t])) if (HEX.test(inp[t][k] || '')) o[t][k] = inp[t][k];
    }
  }
  return o;
}

// ---------- التطبيق ----------
const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// تحديد المحاولات
const attempts = new Map();
function throttle(key, max = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (a.length >= max) return false;
  a.push(now); attempts.set(key, a); return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of attempts) if (!v.some((t) => now - t < 600000)) attempts.delete(k); }, 600000).unref();

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
  try {
    const { id } = jwt.verify(tok, JWT_SECRET);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u || u.disabled) return res.status(401).json({ error: 'الحساب غير متاح' });
    req.user = u; next();
  } catch { res.status(401).json({ error: 'انتهت الجلسة، سجّل الدخول من جديد' }); }
}
const admin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'للمدير فقط' }));
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { console.error(e); res.status(500).json({ error: 'خطأ في الخادم' }); } };

// ---------- عام ----------
app.get('/api/config', wrap((req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.json(getSite()); }));

function content(all) {
  const cats = db.prepare(`SELECT * FROM categories ${all ? '' : 'WHERE visible=1'} ORDER BY sort,id`).all();
  const items = db.prepare(`SELECT * FROM adhkar ${all ? '' : 'WHERE visible=1'} ORDER BY sort,id`).all();
  return cats.map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id) }));
}
app.get('/api/content', wrap((req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.json(content(false)); }));

app.get('/manifest.webmanifest', wrap((req, res) => {
  const s = getSite();
  const icons = s.logoUrl
    ? [{ src: s.logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any' }]
    : [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ];
  res.type('application/manifest+json').json({
    name: s.appName + ' — حصن المسلم', short_name: s.appName, description: s.tagline,
    id: '/', start_url: '/?source=pwa', scope: '/', display: 'standalone', orientation: 'portrait',
    lang: 'ar', dir: 'rtl', background_color: s.themeLight.bg, theme_color: s.themeLight.primary, icons,
    categories: ['education', 'lifestyle'],
  });
}));

// ---------- حسابات ----------
app.post('/api/auth/register', wrap((req, res) => {
  if (!getSite().registrationOpen) return res.status(403).json({ error: 'التسجيل مغلق حاليًا' });
  if (!throttle('reg:' + req.ip, 10, 3600000)) return res.status(429).json({ error: 'محاولات كثيرة، حاول لاحقًا' });
  const name = str(req.body.name, 60).trim();
  const id = normId(req.body.identifier);
  const pw = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'اكتب اسمك' });
  if (!id) return res.status(400).json({ error: 'اكتب بريدًا إلكترونيًا أو رقم هاتف صحيحًا' });
  if (pw.length < 6 || pw.length > 100) return res.status(400).json({ error: 'كلمة السر 6 أحرف على الأقل' });
  if (db.prepare('SELECT 1 FROM users WHERE identifier=?').get(id)) return res.status(409).json({ error: 'هذا الحساب مسجّل مسبقًا، سجّل الدخول' });
  const r = db.prepare('INSERT INTO users(name,identifier,pass_hash,created_at,last_login) VALUES(?,?,?,?,?)')
    .run(name, id, bcrypt.hashSync(pw, 10), Date.now(), Date.now());
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
  res.json({ token: sign(u), user: publicUser(u), isNew: true });
}));

app.post('/api/auth/login', wrap((req, res) => {
  const id = normId(req.body.identifier);
  const pw = String(req.body.password || '');
  if (!throttle('login:' + req.ip + ':' + id)) return res.status(429).json({ error: 'محاولات كثيرة، انتظر قليلًا ثم حاول' });
  const u = id && db.prepare('SELECT * FROM users WHERE identifier=?').get(id);
  if (!u || !bcrypt.compareSync(pw, u.pass_hash)) return res.status(401).json({ error: 'البريد/الهاتف أو كلمة السر غير صحيحة' });
  if (u.disabled) return res.status(403).json({ error: 'هذا الحساب موقوف، تواصل مع الإدارة' });
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(Date.now(), u.id);
  res.json({ token: sign(u), user: publicUser(u) });
}));

app.get('/api/me', auth, wrap((req, res) => res.json({ user: publicUser(req.user) })));

app.patch('/api/me', auth, wrap((req, res) => {
  const u = req.user;
  if (req.body.name != null) {
    const n = str(req.body.name, 60).trim();
    if (!n) return res.status(400).json({ error: 'الاسم فارغ' });
    db.prepare('UPDATE users SET name=? WHERE id=?').run(n, u.id);
  }
  if (req.body.identifier != null) {
    const id = normId(req.body.identifier);
    if (!id) return res.status(400).json({ error: 'بريد/هاتف غير صحيح' });
    if (!bcrypt.compareSync(String(req.body.password || ''), u.pass_hash)) return res.status(401).json({ error: 'كلمة السر غير صحيحة' });
    if (db.prepare('SELECT 1 FROM users WHERE identifier=? AND id<>?').get(id, u.id)) return res.status(409).json({ error: 'مستخدم من قبل حساب آخر' });
    db.prepare('UPDATE users SET identifier=? WHERE id=?').run(id, u.id);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
}));

app.post('/api/me/password', auth, wrap((req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!bcrypt.compareSync(String(oldPassword || ''), req.user.pass_hash)) return res.status(401).json({ error: 'كلمة السر القديمة غير صحيحة' });
  if (String(newPassword || '').length < 6) return res.status(400).json({ error: 'كلمة السر الجديدة 6 أحرف على الأقل' });
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(bcrypt.hashSync(String(newPassword), 10), req.user.id);
  res.json({ ok: true });
}));

// ---------- مزامنة بيانات المستخدم (مشتركة بين الويب والجوال) ----------
const KEYS = ['progress', 'tasks', 'tasbih', 'prefs', 'study'];
app.get('/api/me/data', auth, wrap((req, res) => {
  const rows = db.prepare('SELECT key,value,updated FROM user_data WHERE user_id=?').all(req.user.id);
  const out = {};
  for (const r of rows) out[r.key] = { value: JSON.parse(r.value), updated: r.updated };
  res.json(out);
}));
app.put('/api/me/data/:key', auth, wrap((req, res) => {
  const k = req.params.key;
  if (!KEYS.includes(k)) return res.status(400).json({ error: 'مفتاح غير معروف' });
  const v = JSON.stringify(req.body.value ?? null);
  if (v.length > 300000) return res.status(413).json({ error: 'البيانات كبيرة' });
  const updated = Date.now();
  db.prepare('INSERT INTO user_data(user_id,key,value,updated) VALUES(?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated=excluded.updated')
    .run(req.user.id, k, v, updated);
  res.json({ ok: true, updated });
}));

// ---------- المدير ----------
const A = express.Router();
A.use(auth, admin);

A.put('/settings', wrap((req, res) => { const s = sanitizeSite(req.body || {}, getSite()); saveSite(s); res.json(s); }));
A.post('/settings/reset-theme', wrap((req, res) => {
  const s = getSite(); s.themeLight = defaultSettings.themeLight; s.themeDark = defaultSettings.themeDark; saveSite(s); res.json(s);
}));

A.get('/content', wrap((req, res) => res.json(content(true))));

const slugify = (t) => 'c' + crypto.randomBytes(3).toString('hex');
A.post('/categories', wrap((req, res) => {
  const b = req.body; const title = str(b.title, 80).trim();
  if (!title) return res.status(400).json({ error: 'العنوان مطلوب' });
  const sort = (db.prepare('SELECT MAX(sort) m FROM categories').get().m || 0) + 1;
  const r = db.prepare('INSERT INTO categories(slug,title,icon,audience,sort,visible) VALUES(?,?,?,?,?,?)')
    .run(slugify(title), title, str(b.icon, 8), b.audience === 'student' ? 'student' : 'all', sort, b.visible === false ? 0 : 1);
  res.json(db.prepare('SELECT * FROM categories WHERE id=?').get(r.lastInsertRowid));
}));
A.put('/categories/:id', wrap((req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'غير موجود' });
  const b = req.body;
  db.prepare('UPDATE categories SET title=?, icon=?, audience=?, sort=?, visible=? WHERE id=?').run(
    str(b.title ?? c.title, 80), str(b.icon ?? c.icon, 8), b.audience === 'student' ? 'student' : (b.audience === 'all' ? 'all' : c.audience),
    Number.isFinite(+b.sort) ? +b.sort : c.sort, b.visible == null ? c.visible : (b.visible ? 1 : 0), c.id);
  res.json({ ok: true });
}));
A.delete('/categories/:id', wrap((req, res) => { db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id); res.json({ ok: true }); }));

const audioOk = (u) => !u || /^\/uploads\/[\w.\-]+$/.test(u) || /^https:\/\/[^\s"'<>]+$/.test(u);
A.post('/adhkar', wrap((req, res) => {
  const b = req.body;
  if (!db.prepare('SELECT 1 FROM categories WHERE id=?').get(b.category_id)) return res.status(400).json({ error: 'القسم غير موجود' });
  const text = str(b.text, 4000).trim();
  if (!text) return res.status(400).json({ error: 'النص مطلوب' });
  if (!audioOk(b.audio_url)) return res.status(400).json({ error: 'رابط الصوت غير صالح' });
  const sort = (db.prepare('SELECT MAX(sort) m FROM adhkar WHERE category_id=?').get(b.category_id).m || 0) + 1;
  const r = db.prepare('INSERT INTO adhkar(category_id,text,count,source,virtue,audio_url,sort,visible) VALUES(?,?,?,?,?,?,?,?)')
    .run(b.category_id, text, Math.min(1000, Math.max(1, parseInt(b.count) || 1)), str(b.source, 200), str(b.virtue, 600), str(b.audio_url, 300), sort, b.visible === false ? 0 : 1);
  res.json(db.prepare('SELECT * FROM adhkar WHERE id=?').get(r.lastInsertRowid));
}));
A.put('/adhkar/:id', wrap((req, res) => {
  const a = db.prepare('SELECT * FROM adhkar WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  const b = req.body;
  if (!audioOk(b.audio_url)) return res.status(400).json({ error: 'رابط الصوت غير صالح' });
  db.prepare('UPDATE adhkar SET text=?, count=?, source=?, virtue=?, audio_url=?, sort=?, visible=? WHERE id=?').run(
    str(b.text ?? a.text, 4000), Math.min(1000, Math.max(1, parseInt(b.count ?? a.count) || 1)), str(b.source ?? a.source, 200),
    str(b.virtue ?? a.virtue, 600), str(b.audio_url ?? a.audio_url, 300), Number.isFinite(+b.sort) ? +b.sort : a.sort,
    b.visible == null ? a.visible : (b.visible ? 1 : 0), a.id);
  res.json({ ok: true });
}));
A.delete('/adhkar/:id', wrap((req, res) => { db.prepare('DELETE FROM adhkar WHERE id=?').run(req.params.id); res.json({ ok: true }); }));

const MIME = { 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/wav': '.wav', 'audio/webm': '.webm', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(10).toString('hex') + MIME[file.mimetype]),
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (MIME[file.mimetype] ? cb(null, true) : cb(new Error('نوع الملف غير مدعوم (mp3/ogg/m4a/wav أو png/jpg/webp)'))),
});
A.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    res.json({ url: '/uploads/' + req.file.filename });
  });
});

A.get('/users', wrap((req, res) => {
  const q = '%' + str(req.query.q, 60).toLowerCase() + '%';
  res.json(db.prepare('SELECT id,name,identifier,role,disabled,created_at,last_login FROM users WHERE lower(name) LIKE ? OR identifier LIKE ? ORDER BY id DESC LIMIT 300').all(q, q));
}));
A.patch('/users/:id', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'غير موجود' });
  if (u.id === req.user.id && (req.body.disabled || req.body.role === 'user')) return res.status(400).json({ error: 'لا يمكنك إيقاف/تخفيض حسابك' });
  const role = req.body.role === 'admin' ? 'admin' : req.body.role === 'user' ? 'user' : u.role;
  const disabled = req.body.disabled == null ? u.disabled : (req.body.disabled ? 1 : 0);
  const name = req.body.name != null ? str(req.body.name, 60).trim() || u.name : u.name;
  db.prepare('UPDATE users SET role=?, disabled=?, name=? WHERE id=?').run(role, disabled, name, u.id);
  res.json({ ok: true });
}));
A.post('/users/:id/reset', wrap((req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 6) return res.status(400).json({ error: 'كلمة السر 6 أحرف على الأقل' });
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(bcrypt.hashSync(pw, 10), req.params.id);
  res.json({ ok: true });
}));
A.delete('/users/:id', wrap((req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: 'لا يمكنك حذف حسابك' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id); res.json({ ok: true });
}));
A.get('/stats', wrap((req, res) => {
  const day = Date.now() - 86400000, week = Date.now() - 7 * 86400000;
  res.json({
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    newWeek: db.prepare('SELECT COUNT(*) c FROM users WHERE created_at>?').get(week).c,
    activeDay: db.prepare('SELECT COUNT(*) c FROM users WHERE last_login>?').get(day).c,
    adhkar: db.prepare('SELECT COUNT(*) c FROM adhkar').get().c,
    categories: db.prepare('SELECT COUNT(*) c FROM categories').get().c,
  });
}));
app.use('/api/admin', A);

app.use('/api', (req, res) => res.status(404).json({ error: 'غير موجود' }));

// ---------- ملفات ثابتة ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', setHeaders: (r) => r.setHeader('X-Content-Type-Options', 'nosniff') }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (r, p) => { if (p.endsWith('sw.js') || p.endsWith('.html')) r.setHeader('Cache-Control', 'no-cache'); },
}));
app.use((req, res, next) => req.method === 'GET' ? res.sendFile(path.join(__dirname, 'public', 'index.html')) : next());

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'خطأ في الخادم' }); });

if (require.main === module) app.listen(PORT, () => console.log(`جنى يعمل على http://localhost:${PORT}`));
module.exports = app;
