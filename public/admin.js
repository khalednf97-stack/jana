'use strict';
/* لوحة تحكم المدير: المظهر الكامل، المحتوى، المستخدمون، الإعدادات العامة */
window.JanaAdmin = (function () {
  let X, tab = 'theme', draft = null;
  const COLORS = [['bg', 'الخلفية'], ['surface', 'الأسطح'], ['card', 'البطاقات'], ['primary', 'الأساسي'], ['primaryText', 'نص الأساسي'], ['accent', 'التمييز'], ['gold', 'الذهبي'], ['text', 'النص'], ['muted', 'نص خافت'], ['border', 'الحدود']];
  const FONTS = ['Tajawal', 'Cairo', 'Almarai', 'IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'Amiri', 'Scheherazade New', 'Noto Naskh Arabic', 'Reem Kufi', 'Lateef'];
  const PRESETS = {
    'دافئ (الافتراضي)': { l: { bg: '#fde4c3', surface: '#fff4e3', card: '#fffaf1', primary: '#2f9e92', primaryText: '#ffffff', accent: '#e8909a', gold: '#c99a2e', text: '#3a2a1a', muted: '#8a7560', border: '#f0cf9f' }, d: { bg: '#14201f', surface: '#1b2b2a', card: '#213634', primary: '#3dbfae', primaryText: '#0b1a19', accent: '#e8909a', gold: '#e0b64a', text: '#f1ece2', muted: '#a9b8b3', border: '#2d4a47' } },
    'زمردي': { l: { bg: '#e6f4ec', surface: '#f3fbf6', card: '#ffffff', primary: '#1f7a55', primaryText: '#ffffff', accent: '#d4a72c', gold: '#b8891b', text: '#12301f', muted: '#5b7a69', border: '#c5e3d1' }, d: { bg: '#0d1a14', surface: '#13261c', card: '#1a3226', primary: '#34b27b', primaryText: '#06140d', accent: '#e0b64a', gold: '#e0b64a', text: '#e8f4ed', muted: '#9bb8a8', border: '#25483a' } },
    'أزرق ملكي': { l: { bg: '#e8eefb', surface: '#f4f7fe', card: '#ffffff', primary: '#2c4fa3', primaryText: '#ffffff', accent: '#e0a43a', gold: '#c4922b', text: '#16213f', muted: '#62709a', border: '#cdd8f2' }, d: { bg: '#0e1426', surface: '#151d38', card: '#1c2748', primary: '#6b8cf0', primaryText: '#0a1022', accent: '#f0bb55', gold: '#f0bb55', text: '#eaf0ff', muted: '#a3b0d6', border: '#2b3866' } },
    'وردي هادئ': { l: { bg: '#fbe9ee', surface: '#fff5f8', card: '#ffffff', primary: '#c2577a', primaryText: '#ffffff', accent: '#6bb5a8', gold: '#c99a2e', text: '#3b1f2a', muted: '#9a7482', border: '#f2cfd9' }, d: { bg: '#221018', surface: '#2e1822', card: '#3a2029', primary: '#e07a9d', primaryText: '#2a0c17', accent: '#7cc9bb', gold: '#e0b64a', text: '#fbeef2', muted: '#c9a3b1', border: '#51303f' } },
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function render(ctx) {
    X = ctx; draft = draft || clone(X.CFG());
    const H = X.h;
    const tabs = [['theme', '🎨 المظهر'], ['general', '⚙️ عام'], ['content', '📖 المحتوى'], ['users', '👥 المستخدمون'], ['stats', '📊 إحصائيات']];
    const body = H('div');
    X.shell('لوحة التحكم', [
      H('div', { class: 'tabs' }, tabs.map(([k, t]) => H('button', { class: 'chip' + (tab === k ? ' on' : ''), onclick: () => { tab = k; render(X); } }, t))),
      body,
    ], { back: '#/settings', wide: true });
    ({ theme, general, content, users, stats })[tab](body);
  }

  const err = (e) => X.toast(e.message || 'حدث خطأ');
  async function saveSettings(patch, msg = 'تم الحفظ ✓') {
    try { const s = await X.api('/api/admin/settings', { method: 'PUT', body: patch }); X.S.config = s; localStorage.setItem('jana.config', JSON.stringify(s)); draft = clone(s); X.applyTheme(); X.toast(msg); } catch (e) { err(e); }
  }

  // ---------- المظهر ----------
  function theme(root) {
    const H = X.h; const dark = X.S.prefs.dark === 'on';
    const set = () => X.applyTheme(draft);
    const colorBox = (which) => H('div', { class: 'colors' }, COLORS.map(([k, t]) => {
      const inp = H('input', { type: 'color', value: draft[which][k] });
      inp.addEventListener('input', () => { draft[which][k] = inp.value; set(); });
      return H('label', null, t, inp);
    }));
    const fontSel = (key) => { const s = H('select', { onchange: () => { draft.fonts[key] = s.value; set(); } }, FONTS.map((f) => H('option', { value: f, selected: draft.fonts[key] === f }, f))); return s; };
    const radius = H('input', { type: 'range', min: 0, max: 32, value: draft.radius, oninput: () => { draft.radius = +radius.value; set(); } });
    const scale = H('input', { type: 'range', min: 0.8, max: 1.4, step: 0.05, value: draft.fontScale, oninput: () => { draft.fontScale = +scale.value; set(); } });
    const pat = H('input', { type: 'checkbox', checked: draft.pattern !== false, onchange: () => { draft.pattern = pat.checked; set(); } });
    const logoImg = H('img', { src: draft.logoUrl || '/icons/icon-192.png', style: 'width:72px;height:72px;border-radius:18px;object-fit:cover', alt: '' });
    const file = H('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', onchange: async () => {
      if (!file.files[0]) return; const fd = new FormData(); fd.append('file', file.files[0]);
      try { const r = await X.apiForm('/api/admin/upload', fd); draft.logoUrl = r.url; logoImg.src = r.url; X.toast('تم رفع الشعار، اضغط «حفظ المظهر»'); } catch (e) { err(e); } } });
    root.append(
      H('div', { class: 'card' }, H('b', null, 'المعاينة مباشرة على هذه الصفحة. '), 'غيّر أي لون وسترى النتيجة فورًا، ثم اضغط حفظ.',
        H('div', { class: 'tools', style: 'margin-top:10px' },
          H('button', { class: 'chip' + (!dark ? ' on' : ''), onclick: () => { X.S.prefs.dark = 'off'; X.applyTheme(draft); render(X); } }, '☀️ معاينة الفاتح'),
          H('button', { class: 'chip' + (dark ? ' on' : ''), onclick: () => { X.S.prefs.dark = 'on'; X.applyTheme(draft); render(X); } }, '🌙 معاينة الداكن'))),
      H('div', { class: 'card' }, H('h3', null, 'قوالب جاهزة'), H('div', { class: 'tools' }, Object.keys(PRESETS).map((n) =>
        H('button', { class: 'chip', onclick: () => { draft.themeLight = clone(PRESETS[n].l); draft.themeDark = clone(PRESETS[n].d); set(); render(X); } }, n)))),
      H('div', { class: 'cols two' },
        H('div', { class: 'card' }, H('h3', null, '☀️ ألوان الوضع الفاتح'), colorBox('themeLight')),
        H('div', { class: 'card' }, H('h3', null, '🌙 ألوان الوضع الداكن'), colorBox('themeDark'))),
      H('div', { class: 'card' }, H('h3', null, 'الخطوط والأشكال'),
        H('label', null, 'خط الواجهة'), fontSel('ui'), H('label', null, 'خط الأذكار'), fontSel('text'),
        H('label', null, 'استدارة الزوايا'), radius, H('label', null, 'حجم الخط العام'), scale,
        H('label', { style: 'display:flex;gap:8px;align-items:center' }, pat, 'زخرفة نقطية في الخلفية')),
      H('div', { class: 'card' }, H('h3', null, 'الشعار'), H('div', { class: 'row' }, logoImg,
        H('button', { class: 'btn sm ghost', onclick: () => file.click() }, 'رفع شعار (PNG مربع 512×512)'),
        draft.logoUrl ? H('button', { class: 'btn sm ghost', onclick: () => { draft.logoUrl = ''; logoImg.src = '/icons/icon-192.png'; } }, 'إزالة') : null), file),
      H('div', { class: 'row' },
        H('button', { class: 'btn grow', onclick: () => saveSettings({ themeLight: draft.themeLight, themeDark: draft.themeDark, fonts: draft.fonts, radius: draft.radius, fontScale: draft.fontScale, pattern: draft.pattern, logoUrl: draft.logoUrl }, 'تم حفظ المظهر ✓ — يظهر للجميع') }, '💾 حفظ المظهر'),
        H('button', { class: 'btn ghost', onclick: async () => { if (!confirm('استرجاع الألوان الافتراضية؟')) return; try { const s = await X.api('/api/admin/settings/reset-theme', { method: 'POST' }); X.S.config = s; draft = clone(s); X.applyTheme(); render(X); } catch (e) { err(e); } } }, 'استرجاع الافتراضي')),
      H('p', { class: 'muted' }, 'ملاحظة: أيقونة التطبيق على شاشة الجوال تُحدَّث عند إعادة تثبيته إن غيّرت الشعار.'));
  }

  // ---------- عام ----------
  function general(root) {
    const H = X.h; const c = draft;
    const txt = (label, key, ta, parent = c, max) => { const i = H(ta ? 'textarea' : 'input', { type: 'text', value: parent[key] || '', maxlength: max || 300 }); i.addEventListener('input', () => { parent[key] = i.value; }); return [H('label', null, label), i]; };
    const sw = (label, get, setf) => { const i = H('input', { type: 'checkbox', checked: get(), onchange: () => setf(i.checked) }); return H('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, i, label); };
    const tips = H('textarea', { style: 'min-height:140px' }); tips.value = (c.studyTips || []).join('\n'); tips.addEventListener('input', () => { c.studyTips = tips.value.split('\n').map((s) => s.trim()).filter(Boolean); });
    c.contact ||= {};
    root.append(
      H('div', { class: 'card' }, H('h3', null, 'هوية التطبيق'), txt('اسم التطبيق', 'appName', false, c, 40), txt('الوصف القصير', 'tagline', false, c, 120),
        txt('رسالة الترحيب بعد التسجيل (استخدم {name} للاسم)', 'welcome', true, c, 600), txt('إعلان يظهر أعلى الصفحة الرئيسية (اتركه فارغًا لإخفائه)', 'announcement', true, c, 300)),
      H('div', { class: 'card' }, H('h3', null, 'الأقسام والتسجيل'),
        sw('السماح بتسجيل حسابات جديدة', () => c.registrationOpen !== false, (v) => (c.registrationOpen = v)),
        ...[['journey', 'رحلة الأذكار اليومية'], ['adhkar', 'حصن المسلم'], ['student', 'ركن الطالب'], ['tasbih', 'المسبحة'], ['calendar', 'التقويم']].map(([k, t]) => sw('إظهار: ' + t, () => c.sections[k] !== false, (v) => (c.sections[k] = v)))),
      H('div', { class: 'card' }, H('h3', null, 'روابط التواصل'), txt('رابط إنستغرام', 'instagram', false, c.contact, 200), txt('رابط يوتيوب', 'youtube', false, c.contact, 200), txt('البريد', 'email', false, c.contact, 200), txt('الموقع', 'website', false, c.contact, 200)),
      H('div', { class: 'card' }, H('h3', null, 'نصائح الطالب (كل سطر نصيحة)'), tips),
      H('button', { class: 'btn block', onclick: () => saveSettings({ appName: c.appName, tagline: c.tagline, welcome: c.welcome, announcement: c.announcement, registrationOpen: c.registrationOpen !== false, sections: c.sections, contact: c.contact, studyTips: c.studyTips }) }, '💾 حفظ الإعدادات'));
  }

  // ---------- المحتوى ----------
  async function content(root) {
    const H = X.h; let cats;
    try { cats = await X.api('/api/admin/content'); } catch (e) { return err(e); }
    const refresh = async () => { await X.loadPublic(); render(X); };
    const catForm = (cat) => {
      const f = { title: cat?.title || '', icon: cat?.icon || '', audience: cat?.audience || 'all', visible: cat ? !!cat.visible : true, sort: cat?.sort ?? 0 };
      const t = H('input', { type: 'text', value: f.title }), ic = H('input', { type: 'text', value: f.icon, maxlength: 4 });
      const au = H('select', null, H('option', { value: 'all', selected: f.audience === 'all' }, 'للجميع'), H('option', { value: 'student', selected: f.audience === 'student' }, 'ركن الطالب'));
      const vi = H('input', { type: 'checkbox', checked: f.visible }); const so = H('input', { type: 'number', value: f.sort });
      const close = X.modal(cat ? 'تعديل القسم' : 'قسم جديد', H('div', null, H('label', null, 'العنوان'), t, H('label', null, 'أيقونة (إيموجي)'), ic, H('label', null, 'يظهر في'), au, H('label', null, 'الترتيب'), so,
        H('label', { style: 'display:flex;gap:8px;align-items:center' }, vi, 'ظاهر للمستخدمين'),
        H('button', { class: 'btn block', style: 'margin-top:14px', onclick: async () => {
          const body = { title: t.value, icon: ic.value, audience: au.value, visible: vi.checked, sort: +so.value };
          try { await X.api(cat ? '/api/admin/categories/' + cat.id : '/api/admin/categories', { method: cat ? 'PUT' : 'POST', body }); close(); refresh(); } catch (e) { err(e); } } }, 'حفظ')), { left: true });
    };
    const itemForm = (cat, it) => {
      const ta = H('textarea', { style: 'min-height:140px;font-family:var(--font-text);font-size:1.2rem' }); ta.value = it?.text || '';
      const cnt = H('input', { type: 'number', min: 1, max: 1000, value: it?.count || 1 }), src = H('input', { type: 'text', value: it?.source || '' });
      const vir = H('textarea'); vir.value = it?.virtue || '';
      const au = H('input', { type: 'url', dir: 'ltr', placeholder: 'https://… أو ارفع ملفًا', value: it?.audio_url || '' });
      const file = H('input', { type: 'file', accept: 'audio/*', style: 'display:none', onchange: async () => {
        const fd = new FormData(); fd.append('file', file.files[0]); X.toast('جارٍ الرفع…');
        try { const r = await X.apiForm('/api/admin/upload', fd); au.value = r.url; X.toast('تم رفع الصوت ✓'); } catch (e) { err(e); } } });
      const vi = H('input', { type: 'checkbox', checked: it ? !!it.visible : true });
      const close = X.modal(it ? 'تعديل الذكر' : 'ذكر جديد', H('div', null, H('label', null, 'نص الذكر'), ta, H('label', null, 'عدد التكرار'), cnt, H('label', null, 'المصدر'), src, H('label', null, 'الفضل / ملاحظة'), vir,
        H('label', null, 'ملف صوتي (اختياري — وإلا تُستخدم القراءة الآلية)'), au, H('button', { class: 'btn sm ghost', style: 'margin-top:6px', onclick: () => file.click() }, '⬆ رفع mp3/m4a/ogg'), file,
        H('label', { style: 'display:flex;gap:8px;align-items:center' }, vi, 'ظاهر'),
        H('button', { class: 'btn block', style: 'margin-top:14px', onclick: async () => {
          const body = { category_id: cat.id, text: ta.value, count: +cnt.value, source: src.value, virtue: vir.value, audio_url: au.value.trim(), visible: vi.checked };
          try { await X.api(it ? '/api/admin/adhkar/' + it.id : '/api/admin/adhkar', { method: it ? 'PUT' : 'POST', body }); close(); refresh(); } catch (e) { err(e); } } }, 'حفظ')), { left: true });
    };
    root.append(H('button', { class: 'btn', onclick: () => catForm() }, '+ قسم جديد'),
      ...cats.map((cat) => {
        const d = H('details', { class: 'adm' }, H('summary', null, `${cat.icon || ''} ${cat.title} (${X.nf(cat.items.length)})`, cat.visible ? '' : ' — مخفي', cat.audience === 'student' ? ' — للطالب' : ''),
          H('div', { class: 'tools' }, H('button', { class: 'chip', onclick: () => catForm(cat) }, 'تعديل القسم'), H('button', { class: 'chip', onclick: () => itemForm(cat) }, '+ ذكر'),
            H('button', { class: 'chip', onclick: async () => { if (confirm('حذف القسم وكل أذكاره نهائيًا؟')) try { await X.api('/api/admin/categories/' + cat.id, { method: 'DELETE' }); refresh(); } catch (e) { err(e); } } }, '🗑️ حذف')),
          cat.items.map((it) => H('div', { class: 'ad-item' }, H('div', { class: 't' }, it.text), H('div', { class: 'muted' }, `×${it.count}${it.source ? ' · ' + it.source : ''}${it.audio_url ? ' · 🔊' : ''}${it.visible ? '' : ' · مخفي'}`),
            H('div', { class: 'tools' }, H('button', { class: 'chip', onclick: () => itemForm(cat, it) }, 'تعديل'),
              H('button', { class: 'chip', onclick: async () => { if (confirm('حذف هذا الذكر؟')) try { await X.api('/api/admin/adhkar/' + it.id, { method: 'DELETE' }); refresh(); } catch (e) { err(e); } } }, 'حذف')))));
        return d;
      }));
  }

  // ---------- المستخدمون ----------
  async function users(root) {
    const H = X.h; const box = H('div'); const q = H('input', { type: 'search', placeholder: 'ابحث بالاسم أو البريد/الهاتف' });
    const load = async () => {
      let us; try { us = await X.api('/api/admin/users?q=' + encodeURIComponent(q.value)); } catch (e) { return err(e); }
      const act = async (fn) => { try { await fn(); load(); } catch (e) { err(e); } };
      box.replaceChildren(H('div', { class: 'tbl-wrap' }, H('table', { class: 'tbl' }, H('thead', null, H('tr', null, ['الاسم', 'الحساب', 'الحالة', 'التسجيل', 'آخر دخول', ''].map((x) => H('th', null, x)))),
        H('tbody', null, us.map((u) => H('tr', null, H('td', null, u.name), H('td', { dir: 'ltr', style: 'text-align:right' }, u.identifier),
          H('td', null, H('span', { class: 'badge' + (u.role === 'admin' ? ' admin' : '') }, u.role === 'admin' ? 'مدير' : 'مستخدم'), u.disabled ? H('span', { class: 'badge off' }, 'موقوف') : null),
          H('td', null, new Date(u.created_at).toLocaleDateString('ar')), H('td', null, u.last_login ? new Date(u.last_login).toLocaleDateString('ar') : '—'),
          H('td', null, H('div', { class: 'tools' },
            H('button', { class: 'chip', onclick: () => act(() => X.api('/api/admin/users/' + u.id, { method: 'PATCH', body: { role: u.role === 'admin' ? 'user' : 'admin' } })) }, u.role === 'admin' ? 'إلغاء المدير' : 'ترقية'),
            H('button', { class: 'chip', onclick: () => act(() => X.api('/api/admin/users/' + u.id, { method: 'PATCH', body: { disabled: !u.disabled } })) }, u.disabled ? 'تفعيل' : 'إيقاف'),
            H('button', { class: 'chip', onclick: () => { const p = prompt('كلمة سر جديدة (6 أحرف فأكثر) للمستخدم ' + u.name); if (p) act(async () => { await X.api('/api/admin/users/' + u.id + '/reset', { method: 'POST', body: { password: p } }); X.toast('تم تغيير كلمة السر'); }); } }, 'كلمة سر'),
            H('button', { class: 'chip', onclick: () => { if (confirm('حذف حساب ' + u.name + ' وكل بياناته نهائيًا؟')) act(() => X.api('/api/admin/users/' + u.id, { method: 'DELETE' })); } }, '🗑️')))))))));
    };
    q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(load, 300); });
    root.append(H('div', { class: 'card' }, q), H('div', { class: 'card' }, box)); load();
  }

  // ---------- إحصائيات ----------
  async function stats(root) {
    const H = X.h; let s; try { s = await X.api('/api/admin/stats'); } catch (e) { return err(e); }
    root.append(H('div', { class: 'grid g3' }, [['المستخدمون', s.users], ['جدد هذا الأسبوع', s.newWeek], ['نشطون اليوم', s.activeDay], ['الأذكار', s.adhkar], ['الأقسام', s.categories]].map(([t, n]) => H('div', { class: 'card stat' }, H('b', null, X.nf(n)), t))));
  }

  return { render };
})();
