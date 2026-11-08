/* ================= Firebase ================= */
const firebaseConfig = {
  apiKey: "AIzaSyBz20RhNsxa7ORUXePNOqRQLt4Q81UxFPY",
  authDomain: "daretotry-57d16.firebaseapp.com",
  projectId: "daretotry-57d16",
  storageBucket: "daretotry-57d16.firebasestorage.app",
  messagingSenderId: "69401268575",
  appId: "1:69401268575:web:19d6fe87bad4530395e6ea",
  measurementId: "G-3N17FQ8P4F"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
try { db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}

/* ================= 常數 ================= */
const TAGS = {
  joy:     { emoji: '🌼', name: '喜樂' },
  accept:  { emoji: '🤍', name: '接受自己' },
  forward: { emoji: '🌱', name: '往前' },
  back:    { emoji: '🔁', name: '失敗了，但回來了' }
};
const PROMPTS = [
  '今天哪個時刻，我有一點像她？',
  '今天卡住的時候，她會怎麼做？',
  '今天有什麼小事讓我開心？',
  '今天哪裡做得不完美，但我接受它？',
  '今天比昨天多走了哪一小步？',
  '今天失敗了什麼？我怎麼回來的？',
  '今天學到的一件事是？',
  '現在的我，想對自己說什麼？'
];
const WEEKDAYS = ['日','一','二','三','四','五','六'];

/* ================= 狀態 ================= */
let logs = [];
let scenarios = [];
let me = { words: '喜樂・接受自己・有上進心往前', motto: '她也會失敗，只是會回來。' };
let filterTag = 'all';
let searchKw = '';
let unsubs = [];
let unsubLogs = null;
const PAGE = 40;          // 一次只載入最近 40 則，開啟更快
let logLimit = PAGE;
const photoCache = {};    // 高畫質照片：點開才下載
let compose = resetCompose();

function resetCompose() {
  return { editId: null, tag: null, photo: null, orig: null, layers: null, existingPhoto: false };
}

/* ================= 小工具 ================= */
const $ = (id) => document.getElementById(id);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function localDate(d = new Date()) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function localTime(d = new Date()) { const p = n => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800); }
function copyText(s) { navigator.clipboard?.writeText(s).then(() => toast('已複製')).catch(() => prompt('複製這串：', s)); }
function textOf(item) { return item.feeling || item.text || ''; }
function actionOf(item) { return item.action || item.title || ''; }
function dayLabel(dateStr) {
  const today = localDate();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const d = parseDate(dateStr);
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  if (dateStr === today) return ['今天', md + '・週' + WEEKDAYS[d.getDay()]];
  if (dateStr === localDate(y)) return ['昨天', md + '・週' + WEEKDAYS[d.getDay()]];
  return [md, (d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '・' : '') + '週' + WEEKDAYS[d.getDay()]];
}

/* ================= 登入 ================= */
$('loginBtn').onclick = async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  $('loginMsg').textContent = '登入中…';
  try {
    await auth.signInWithPopup(provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) {
      try { await auth.signInWithRedirect(provider); } catch (e2) { $('loginMsg').textContent = '登入失敗：' + e2.message; }
    } else if (e.code === 'auth/unauthorized-domain') {
      $('loginMsg').textContent = '這個網址還沒加到 Firebase 的「授權網域」，請先到 Firebase 後台加上 ' + location.hostname;
    } else {
      $('loginMsg').textContent = '登入失敗：' + e.message;
    }
  }
};
auth.getRedirectResult().catch(e => { $('loginMsg').textContent = '登入失敗：' + e.message; });
function logout() { auth.signOut(); }

auth.onAuthStateChanged(user => {
  unsubs.forEach(u => u()); unsubs = [];
  if (unsubLogs) { unsubLogs(); unsubLogs = null; }
  try { user ? localStorage.setItem('life_signed', '1') : localStorage.removeItem('life_signed'); } catch (e) {}
  if (!user) {
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('noPerm').classList.add('hidden');
    $('loginBtn').classList.remove('hidden');
    $('loginMsg').textContent = '';
    return;
  }
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('acct').innerHTML = `已登入：${esc(user.displayName || '')} ${esc(user.email || '')}<br>UID：${esc(user.uid)}`;
  startListeners();
});

function permissionDenied() {
  const user = auth.currentUser;
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('loginBtn').classList.add('hidden');
  $('loginMsg').textContent = '';
  $('noPermUid').textContent = user ? user.uid : '';
  $('noPerm').classList.remove('hidden');
}

let hasMore = false;
function listenLogs(onErr) {
  if (unsubLogs) unsubLogs();
  unsubLogs = db.collection('logs').orderBy('date', 'desc').limit(logLimit).onSnapshot(snap => {
    logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    hasMore = snap.size >= logLimit;
    renderAll();
  }, onErr || ((e) => { console.error(e); if (e.code === 'permission-denied') permissionDenied(); }));
}
function loadMore() { logLimit += PAGE; listenLogs(); }
function moreBtn() { return hasMore ? `<div style="text-align:center;margin:16px 0 8px;grid-column:1/-1"><button class="btn ghost" onclick="loadMore()">載入更早的記錄</button></div>` : ''; }

/* 高畫質照片放在 photos 集合，點開時才下載 */
async function getFull(item) {
  if (!item.hasFull) return { full: item.imgUrl, orig: item.origUrl || null, layers: item.layers || [] };
  if (!photoCache[item.id]) {
    const d = await db.collection('photos').doc(item.id).get();
    photoCache[item.id] = d.exists ? d.data() : { full: item.imgUrl };
  }
  const p = photoCache[item.id];
  return { full: p.full || item.imgUrl, orig: p.orig || null, layers: p.layers || [] };
}

function startListeners() {
  const onErr = (e) => { console.error(e); if (e.code === 'permission-denied') permissionDenied(); else toast('同步出了點問題'); };
  listenLogs(onErr);
  unsubs.push(db.collection('scenarios').onSnapshot(snap => {
    scenarios = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    renderScenarios();
  }, onErr));
  unsubs.push(db.collection('settings').doc('me').onSnapshot(doc => {
    if (doc.exists) me = { ...me, ...doc.data() };
    renderMe();
  }, onErr));
}

/* ================= 分頁 ================= */
let currentView = 'feed';
document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => switchView(b.dataset.view));
function switchView(v) {
  currentView = v;
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  ['feed', 'wall', 'her'].forEach(x => $('view-' + x).classList.toggle('hidden', x !== v));
  $('filters').classList.toggle('hidden', v === 'her');
  $('searchToggle').classList.toggle('hidden', v === 'her');
  if (v === 'her') $('searchBox').classList.add('hidden');
  window.scrollTo({ top: 0 });
  renderAll();
}

/* ================= 篩選 / 搜尋 ================= */
function renderFilters() {
  const items = [['all', '全部'], ...Object.entries(TAGS).map(([k, t]) => [k, t.emoji + ' ' + t.name])];
  $('filters').innerHTML = items.map(([k, label]) => `<button class="chip ${filterTag === k ? 'on' : ''}" data-tag="${k}">${label}</button>`).join('');
  $('filters').querySelectorAll('.chip').forEach(c => c.onclick = () => { filterTag = c.dataset.tag; renderAll(); });
}
$('searchToggle').onclick = () => {
  const box = $('searchBox'); box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) $('searchInput').focus(); else { $('searchInput').value = ''; searchKw = ''; renderAll(); }
};
$('searchInput').oninput = (e) => { searchKw = e.target.value.trim().toLowerCase(); renderAll(); };

function filtered() {
  return logs.filter(i => {
    if (filterTag !== 'all' && i.tag !== filterTag) return false;
    if (searchKw) {
      const hay = (actionOf(i) + ' ' + textOf(i)).toLowerCase();
      if (!hay.includes(searchKw)) return false;
    }
    return true;
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));
}

/* ================= 記錄流 ================= */
function postHTML(i) {
  const t = TAGS[i.tag];
  const act = actionOf(i), txt = textOf(i);
  return `
    <article class="post ${i.tag || ''}" data-id="${esc(i.id)}">
      <div class="meta">
        <span>${esc(i.time || '全天')}</span>
        ${t ? `<span class="tagpill ${i.tag}">${t.emoji} ${t.name}</span>` : ''}
        <button class="more" data-more="${esc(i.id)}" aria-label="更多">⋯</button>
      </div>
      ${act ? `<div class="act">${esc(act)}</div>` : ''}
      ${txt ? `<div class="txt">${esc(txt)}</div>` : ''}
      ${i.imgUrl ? `<div class="ph"><img loading="lazy" src="${i.imgUrl}" data-lb="${esc(i.id)}" alt="">${(i.origUrl || i.hasOrig) ? `<button class="swap" data-swap="${esc(i.id)}">看原圖</button>` : ''}</div>` : ''}
    </article>`;
}
function renderFeed() {
  const list = filtered();
  if (!list.length) {
    $('feed').innerHTML = `<div class="empty">${logs.length ? '沒有符合的記錄' : '還沒有記錄。<br>寫下第一則吧，Day 1 從現在開始 🌱'}</div>`;
    return;
  }
  let html = '', last = null;
  for (const i of list) {
    if (i.date !== last) {
      last = i.date;
      const [a, b] = dayLabel(i.date || localDate());
      html += `<div class="day-head"><b>${a}</b><span>${b}</span></div>`;
    }
    html += postHTML(i);
  }
  $('feed').innerHTML = html + moreBtn();
  $('feed').querySelectorAll('[data-more]').forEach(b => b.onclick = (e) => { e.stopPropagation(); openPostMenu(b.dataset.more); });
  $('feed').querySelectorAll('[data-lb]').forEach(img => img.onclick = () => openLightbox(img.dataset.lb));
  $('feed').querySelectorAll('[data-swap]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const item = logs.find(x => x.id === b.dataset.swap); const img = b.parentElement.querySelector('img');
    if (b.dataset.showing === 'orig') { img.src = item.imgUrl; b.dataset.showing = ''; b.textContent = '看原圖'; return; }
    b.textContent = '載入中…';
    const p = await getFull(item);
    if (p.orig) { img.src = p.orig; b.dataset.showing = 'orig'; b.textContent = '看編輯後'; } else b.textContent = '看原圖';
  });
}

function openPostMenu(id) {
  const item = logs.find(x => x.id === id); if (!item) return;
  sheet(`
    <div class="menu">
      <button data-a="edit">編輯</button>
      ${item.imgUrl ? `<button data-a="dl">下載照片</button>` : ''}
      ${(item.origUrl || item.hasOrig) ? `<button data-a="dlo">下載原圖</button>` : ''}
      <button data-a="del" class="danger">刪除</button>
      <button data-a="close">取消</button>
    </div>`, (root, close) => {
    root.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'edit') { close(); startEdit(item); }
      if (a === 'dl') { const p = await getFull(item); download(p.full, `life_${item.date}.jpg`); }
      if (a === 'dlo') { const p = await getFull(item); p.orig && download(p.orig, `life_${item.date}_原圖.jpg`); }
      if (a === 'del') {
        if (b.dataset.sure) {
          await db.collection('logs').doc(id).delete();
          if (item.hasFull) db.collection('photos').doc(id).delete().catch(() => {});
          close(); toast('已刪除');
        }
        else { b.dataset.sure = 1; b.textContent = '再按一次確定刪除'; }
      }
      if (a === 'close') close();
    });
  });
}
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }

/* ================= 照片牆 ================= */
function renderWall() {
  const list = filtered().filter(i => i.imgUrl);
  $('wallCount').textContent = list.length ? `${list.length} 張` : '';
  $('wall').innerHTML = list.length
    ? list.map(i => `<div class="cell" data-lb="${esc(i.id)}"><img loading="lazy" src="${i.imgUrl}" alt="">${i.tag ? `<i class="${i.tag}"></i>` : ''}</div>`).join('')
    : `<div class="empty" style="grid-column:1/-1;background:var(--card)">還沒有照片。<br>在「記錄」裡加一張吧 📷</div>`;
  $('wall').insertAdjacentHTML('beforeend', moreBtn());
  $('wall').querySelectorAll('[data-lb]').forEach(c => c.onclick = () => openLightbox(c.dataset.lb));
}
function openLightbox(id) {
  const i = logs.find(x => x.id === id); if (!i) return;
  const t = TAGS[i.tag];
  const el = document.createElement('div'); el.className = 'lb';
  el.innerHTML = `
    <div class="lb-top"><span>${esc(i.date)} ${esc(i.time || '')} ${t ? '・' + t.emoji + ' ' + t.name : ''}</span>
      <span style="display:flex;gap:8px">${(i.origUrl || i.hasOrig) ? '<button class="ed-pill" data-o>看原圖</button>' : ''}<button class="ed-pill" data-c>關閉</button></span></div>
    <div class="lb-img"><img src="${i.imgUrl}" alt=""></div>
    ${(actionOf(i) || textOf(i)) ? `<div class="lb-cap">${actionOf(i) ? '<b>' + esc(actionOf(i)) + '</b>\n' : ''}${esc(textOf(i))}</div>` : ''}`;
  document.body.appendChild(el);
  el.querySelector('[data-c]').onclick = () => el.remove();
  const imgEl = el.querySelector('.lb-img img');
  let full = i.imgUrl, orig = null, showingOrig = false;
  // 先顯示小圖，背景再換成高畫質
  getFull(i).then(p => { full = p.full; orig = p.orig; if (!showingOrig && document.body.contains(el)) imgEl.src = full; }).catch(() => {});
  const o = el.querySelector('[data-o]');
  if (o) o.onclick = async () => {
    if (!orig) { o.textContent = '載入中…'; const p = await getFull(i); full = p.full; orig = p.orig; }
    showingOrig = !showingOrig; imgEl.src = showingOrig ? orig : full; o.textContent = showingOrig ? '看編輯後' : '看原圖';
  };
}

/* ================= 她 ================= */
function renderMe() {
  $('herWords').textContent = me.words;
  $('herMotto').textContent = me.motto;
  $('headerSub').textContent = me.words.replace('有上進心', '');
}
$('herEditBtn').onclick = () => {
  sheet(`
    <h3 class="serif" style="margin:0 0 10px">我想成為的人</h3>
    <input class="field" id="meW" value="${esc(me.words)}">
    <input class="field" id="meM" value="${esc(me.motto)}" placeholder="一句提醒自己的話">
    <button class="btn" id="meSave">儲存</button>`, (root, close) => {
    root.querySelector('#meSave').onclick = async () => {
      await db.collection('settings').doc('me').set({ words: root.querySelector('#meW').value.trim() || me.words, motto: root.querySelector('#meM').value.trim() }, { merge: true });
      close(); toast('已更新');
    };
  });
};
function renderStats() {
  const today = parseDate(localDate());
  const start = new Date(today); start.setDate(start.getDate() - 6);
  const inWeek = logs.filter(i => i.date && parseDate(i.date) >= start && parseDate(i.date) <= today);
  $('stats').innerHTML = Object.entries(TAGS).map(([k, t]) =>
    `<div class="stat ${k}"><b>${inWeek.filter(i => i.tag === k).length}</b><span>${t.emoji} ${k === 'back' ? '回來了' : t.name}</span></div>`).join('');
  let days = 0, html = '';
  for (let n = 6; n >= 0; n--) {
    const d = new Date(today); d.setDate(d.getDate() - n);
    const ds = localDate(d); const on = logs.some(i => i.date === ds); if (on) days++;
    html += `<div><i class="${on ? 'on' : ''} ${n === 0 ? 'today' : ''}"></i>${WEEKDAYS[d.getDay()]}</div>`;
  }
  $('week').innerHTML = html;
  $('weekNote').textContent = days === 0 ? '這週還沒記錄，今天開始也很好 🌱' : days === 7 ? '連續 7 天都有記錄，她真的在長出來 ✨' : `這 7 天裡有 ${days} 天留下了記錄。斷掉沒關係，接著來就好。`;
}
function renderScenarios() {
  $('scnList').innerHTML = scenarios.length ? scenarios.map(s => `
    <div class="scn"><div><div class="s">當 ${esc(s.situation)}</div><div class="a">她會 ${esc(s.action)}</div></div><button data-del="${esc(s.id)}">✕</button></div>`).join('')
    : `<div class="small" style="padding:6px 0">還沒有情境，先加一條吧。</div>`;
  $('scnList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (b.dataset.sure) await db.collection('scenarios').doc(b.dataset.del).delete();
    else { b.dataset.sure = 1; b.textContent = '刪除?'; }
  });
}
$('scnAdd').onclick = async () => {
  const s = $('scnS').value.trim(), a = $('scnA').value.trim();
  if (!s || !a) { toast('情境和她會怎麼做都要寫喔'); return; }
  await db.collection('scenarios').add({ situation: s, action: a, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  $('scnS').value = ''; $('scnA').value = ''; toast('她又完整了一點');
};
$('copyUidBtn').onclick = () => auth.currentUser && copyText(auth.currentUser.uid);

function renderAll() {
  renderFilters();
  if (currentView === 'feed') renderFeed();
  if (currentView === 'wall') renderWall();
  if (currentView === 'her') { renderStats(); renderScenarios(); renderMe(); }
}

/* ================= 撰寫 ================= */
function renderComposeTags() {
  $('cTags').innerHTML = Object.entries(TAGS).map(([k, t]) => `<button class="chip ${compose.tag === k ? 'on' : ''}" data-tag="${k}">${t.emoji} ${t.name}</button>`).join('');
  $('cTags').querySelectorAll('.chip').forEach(c => c.onclick = () => { compose.tag = compose.tag === c.dataset.tag ? null : c.dataset.tag; renderComposeTags(); });
}
function updateSend() { $('cSend').disabled = !($('cText').value.trim() || compose.photo); }
function autosize() { const t = $('cText'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 320) + 'px'; }
$('cText').oninput = () => { autosize(); updateSend(); };
$('cPromptBtn').onclick = () => {
  const cur = $('cText').placeholder; let p; do { p = PROMPTS[Math.floor(Math.random() * PROMPTS.length)]; } while (p === cur && PROMPTS.length > 1);
  $('cText').placeholder = p; $('cText').focus();
};
$('cPhotoBtn').onclick = () => $('cFile').click();
$('cFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const orig = await fileToDataURL(f, 1440, 0.82);
  compose.orig = orig; compose.layers = []; compose.existingPhoto = false;
  openEditor(orig, [], (result) => setComposePhoto(result));
};
$('cEditPhoto').onclick = () => {
  if (!compose.orig) return;
  openEditor(compose.orig, compose.layers || [], (result) => setComposePhoto(result));
};
$('cRemovePhoto').onclick = () => { compose.photo = null; compose.orig = null; compose.layers = null; compose.existingPhoto = false; showPreview(); updateSend(); };
function setComposePhoto(result) {
  // result: { dataUrl, layers, edited }
  compose.photo = result.dataUrl; compose.layers = result.layers; compose.edited = result.edited; compose.existingPhoto = false;
  showPreview(); updateSend();
}
function showPreview() {
  $('cPreview').classList.toggle('hidden', !compose.photo);
  if (compose.photo) $('cPreviewImg').src = compose.photo;
  $('cEditPhoto').classList.toggle('hidden', !compose.orig);
}
function resetComposer() {
  compose = resetCompose();
  $('cText').value = ''; autosize();
  $('cDate').value = localDate(); $('cTime').value = localTime();
  $('cSend').textContent = '記下';
  showPreview(); renderComposeTags(); updateSend();
  $('composer').querySelector('.cancel-edit')?.remove();
}
function startEdit(item) {
  switchView('feed');
  compose = resetCompose();
  compose.editId = item.id; compose.tag = item.tag || null;
  compose.photo = item.imgUrl || null; compose.orig = item.origUrl || item.imgUrl || null;
  compose.layers = item.layers || []; compose.existingPhoto = !!item.imgUrl;
  $('cText').value = [actionOf(item), textOf(item)].filter(Boolean).join('\n');
  $('cDate').value = item.date || localDate(); $('cTime').value = item.time || '';
  $('cSend').textContent = '更新';
  if (!$('composer').querySelector('.cancel-edit')) {
    const c = document.createElement('button'); c.className = 'tool cancel-edit'; c.textContent = '取消編輯';
    c.onclick = resetComposer; $('composer').querySelector('.tools').appendChild(c);
  }
  showPreview(); renderComposeTags(); autosize(); updateSend();
  $('cText').focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
  if (item.hasFull) {
    getFull(item).then(p => {
      if (compose.editId !== item.id) return;
      compose.orig = p.orig || p.full; compose.layers = p.layers || []; showPreview();
    }).catch(() => {});
  }
}

$('cSend').onclick = async () => {
  const text = $('cText').value.trim();
  if (!text && !compose.photo) return;
  const btn = $('cSend'); btn.disabled = true; btn.textContent = '儲存中…';
  try {
    const data = {
      date: $('cDate').value || localDate(),
      time: $('cTime').value || localTime(),
      type: compose.photo ? 'photo' : 'timeline',
      action: '',
      feeling: text,
      tag: compose.tag || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const id = compose.editId || Date.now().toString();
    const DEL = firebase.firestore.FieldValue.delete();
    let photoDoc = null;
    if (compose.photo) {
      if (!compose.existingPhoto) {
        // 記錄裡只放一張小圖（列表、照片牆用，載入快）；高畫質和原圖另外存，點開才下載
        let full = compose.photo, orig = compose.edited ? compose.orig : null;
        const size = () => full.length + (orig ? orig.length : 0);
        // Firestore 單筆上限約 1MB，太大就再壓縮
        if (size() > 900000 && orig) orig = await recompress(orig, 1080, 0.7);
        if (size() > 900000) full = await recompress(full, 1080, 0.72);
        if (size() > 900000 && orig) orig = null;
        if (size() > 900000) full = await recompress(full, 900, 0.65);
        data.imgUrl = await recompress(full, 720, 0.7);
        data.hasFull = true;
        data.hasOrig = !!orig;
        data.origUrl = DEL; data.layers = DEL;
        photoDoc = { full, orig: orig || null, layers: compose.edited ? (compose.layers || []) : [] };
      }
    } else if (compose.editId) {
      Object.assign(data, { imgUrl: DEL, origUrl: DEL, layers: DEL, hasFull: DEL, hasOrig: DEL });
      db.collection('photos').doc(id).delete().catch(() => {});
    }
    if (photoDoc) { await db.collection('photos').doc(id).set(photoDoc); photoCache[id] = photoDoc; }
    if (!compose.editId) { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); data.source = 'web'; }
    // merge:true 才能接受 FieldValue.delete()
    await db.collection('logs').doc(id).set(data, { merge: true });
    toast(compose.editId ? '已更新' : compose.tag === 'back' ? '回來了，就很好 🔁' : '記下了 🌱');
    resetComposer();
  } catch (e) {
    console.error(e);
    toast(e.code === 'permission-denied' ? '沒有權限，請檢查安全規則' : '儲存失敗：' + (e.message || ''));
    btn.disabled = false; btn.textContent = compose.editId ? '更新' : '記下';
  }
};

/* ================= 圖片處理 ================= */
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function fileToDataURL(file, maxDim, q) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = async () => { try { resolve(await recompress(r.result, maxDim, q)); } catch (e) { reject(e); } };
    r.onerror = reject; r.readAsDataURL(file);
  });
}
async function recompress(src, maxDim, q) {
  const img = await loadImage(src);
  let w = img.naturalWidth, h = img.naturalHeight;
  const s = Math.min(1, maxDim / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', q);
}

/* ================= 限動式編輯器 ================= */
const ED_COLORS = ['#FFFFFF', '#3F3A36', '#F6EBD2', '#F5E3E1', '#E3EDE1', '#ECE7F3', '#D9A441', '#C98585', '#7E9E7A', '#9A8BB8'];
function contrast(hex) {
  const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#3F3A36' : '#FFFFFF';
}

function openEditor(src, initialLayers, onDone) {
  let layers = JSON.parse(JSON.stringify(initialLayers || []));
  let sel = null;
  const el = document.createElement('div'); el.className = 'ed';
  el.innerHTML = `
    <div class="ed-top">
      <button class="ed-pill" data-cancel>取消</button>
      <div class="r">
        <button class="ed-pill" data-orig>保留原圖</button>
        <button class="ed-pill main" data-done>完成</button>
      </div>
    </div>
    <div class="ed-stage-wrap"><div class="ed-stage"><img alt=""></div></div>
    <div class="ed-bottom">
      <div data-selrow class="hidden">
        <div class="ed-row">${ED_COLORS.map(c => `<button class="sw" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
        <div class="ed-row">
          <button class="ed-pill" data-bg>底色</button>
          <button class="ed-pill" data-edit>改字</button>
          <span style="font-size:12px;opacity:.7;white-space:nowrap;flex:none">大小</span><input type="range" min="3" max="14" step="0.5" data-size>
          <button class="ed-pill" data-delete>刪除</button>
        </div>
      </div>
      <div class="ed-row" data-addrow>
        <button class="ed-pill" data-add>Aa 文字</button>
        <button class="ed-pill" data-date>📅 日期</button>
        ${Object.entries(TAGS).map(([k, t]) => `<button class="ed-pill" data-tagst="${k}">${t.emoji} ${k === 'back' ? '回來了' : t.name}</button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(el);
  const stage = el.querySelector('.ed-stage');
  const img = stage.querySelector('img'); img.src = src;

  function draw() {
    stage.querySelectorAll('.layer').forEach(n => n.remove());
    const W = stage.clientWidth || 1;
    layers.forEach((L, idx) => {
      const n = document.createElement('div'); n.className = 'layer' + (idx === sel ? ' sel' : '');
      n.textContent = L.text;
      n.style.left = (L.x * 100) + '%'; n.style.top = (L.y * 100) + '%';
      n.style.fontSize = (L.size / 100 * W) + 'px';
      if (L.bg) { n.style.background = L.color; n.style.color = contrast(L.color); n.style.textShadow = 'none'; }
      else { n.style.background = 'transparent'; n.style.color = L.color; n.style.textShadow = '0 1px 6px rgba(0,0,0,.35)'; }
      attachDrag(n, idx);
      stage.appendChild(n);
    });
    el.querySelector('[data-selrow]').classList.toggle('hidden', sel === null);
    if (sel !== null) {
      el.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === layers[sel].color));
      el.querySelector('[data-size]').value = layers[sel].size;
      el.querySelector('[data-bg]').textContent = layers[sel].bg ? '取消底色' : '加底色';
    }
  }
  function attachDrag(n, idx) {
    let sx, sy, ox, oy, moved = false, lastTap = n._lastTap || 0;
    n.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); n.setPointerCapture(e.pointerId);
      sx = e.clientX; sy = e.clientY; ox = layers[idx].x; oy = layers[idx].y; moved = false;
    });
    n.addEventListener('pointermove', (e) => {
      if (sx === undefined) return;
      const r = stage.getBoundingClientRect();
      const dx = (e.clientX - sx) / r.width, dy = (e.clientY - sy) / r.height;
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
      layers[idx].x = Math.min(1, Math.max(0, ox + dx)); layers[idx].y = Math.min(1, Math.max(0, oy + dy));
      n.style.left = (layers[idx].x * 100) + '%'; n.style.top = (layers[idx].y * 100) + '%';
    });
    n.addEventListener('pointerup', () => {
      sx = undefined;
      if (!moved) {
        const now = Date.now();
        if (sel === idx && now - lastTap < 350) { editText(idx); return; }
        lastTap = now; sel = idx; draw();
        const nn = stage.querySelectorAll('.layer')[idx]; if (nn) nn._lastTap = now;
      }
    });
  }
  stage.addEventListener('pointerdown', (e) => { if (e.target === stage || e.target === img) { sel = null; draw(); } });
  el.querySelector('.ed-stage-wrap').addEventListener('pointerdown', (e) => { if (e.target.classList.contains('ed-stage-wrap')) { sel = null; draw(); } });

  function textInput(initial, cb) {
    const box = document.createElement('div'); box.className = 'ed-input';
    box.innerHTML = `<textarea placeholder="輸入文字">${esc(initial)}</textarea><div style="display:flex;gap:10px;margin-top:16px"><button class="ed-pill" data-x>取消</button><button class="ed-pill main" data-ok>好了</button></div>`;
    document.body.appendChild(box);
    const ta = box.querySelector('textarea'); setTimeout(() => ta.focus(), 50);
    box.querySelector('[data-x]').onclick = () => box.remove();
    box.querySelector('[data-ok]').onclick = () => { const v = ta.value.trim(); box.remove(); cb(v); };
  }
  function addLayer(L) { layers.push({ x: .5, y: .5, size: 7, color: '#FFFFFF', bg: false, ...L }); sel = layers.length - 1; draw(); }
  function editText(idx) { textInput(layers[idx].text, (v) => { if (v) layers[idx].text = v; else { layers.splice(idx, 1); sel = null; } draw(); }); }

  el.querySelector('[data-add]').onclick = () => textInput('', (v) => v && addLayer({ text: v }));
  el.querySelector('[data-date]').onclick = () => {
    const d = new Date(); addLayer({ text: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, size: 4.5, color: '#FFFFFF', bg: true, y: .9 });
  };
  el.querySelectorAll('[data-tagst]').forEach(b => b.onclick = () => {
    const k = b.dataset.tagst, t = TAGS[k];
    const col = { joy: '#F6EBD2', accept: '#F5E3E1', forward: '#E3EDE1', back: '#ECE7F3' }[k];
    addLayer({ text: `${t.emoji} ${t.name}`, size: 4.5, color: col, bg: true, y: .1 });
  });
  el.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { if (sel !== null) { layers[sel].color = b.dataset.color; draw(); } });
  el.querySelector('[data-bg]').onclick = () => { if (sel !== null) { layers[sel].bg = !layers[sel].bg; draw(); } };
  el.querySelector('[data-edit]').onclick = () => sel !== null && editText(sel);
  el.querySelector('[data-size]').oninput = (e) => { if (sel !== null) { layers[sel].size = +e.target.value; draw(); } };
  el.querySelector('[data-delete]').onclick = () => { if (sel !== null) { layers.splice(sel, 1); sel = null; draw(); } };

  el.querySelector('[data-cancel]').onclick = () => el.remove();
  el.querySelector('[data-orig]').onclick = () => { el.remove(); onDone({ dataUrl: src, layers: [], edited: false }); };
  el.querySelector('[data-done]').onclick = async () => {
    if (!layers.length) { el.remove(); onDone({ dataUrl: src, layers: [], edited: false }); return; }
    const out = await renderLayers(src, layers);
    el.remove(); onDone({ dataUrl: out, layers, edited: true });
  };

  img.onload = () => draw();
  if (img.complete) draw();
  window.addEventListener('resize', draw, { once: true });
}

async function renderLayers(src, layers) {
  try { await document.fonts.load('700 40px "Noto Sans TC"'); } catch (e) {}
  const base = await loadImage(src);
  const W = base.naturalWidth, H = base.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(base, 0, 0, W, H);
  for (const L of layers) {
    const fs = L.size / 100 * W;
    ctx.font = `700 ${fs}px "Noto Sans TC", "PingFang TC", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = L.text.split('\n');
    const lh = fs * 1.25;
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
    const padX = fs * .45, padY = fs * .12;
    const bw = tw + padX * 2, bh = lh * lines.length + padY * 2;
    const cx = L.x * W, cy = L.y * H;
    if (L.bg) {
      ctx.fillStyle = L.color;
      const r = fs * .4, x = cx - bw / 2, y = cy - bh / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + bw, y, x + bw, y + bh, r); ctx.arcTo(x + bw, y + bh, x, y + bh, r);
      ctx.arcTo(x, y + bh, x, y, r); ctx.arcTo(x, y, x + bw, y, r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = contrast(L.color); ctx.shadowColor = 'transparent';
    } else {
      ctx.fillStyle = L.color; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = fs * .25; ctx.shadowOffsetY = fs * .04;
    }
    lines.forEach((l, i) => ctx.fillText(l, cx, cy - (lh * (lines.length - 1)) / 2 + i * lh));
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }
  return c.toDataURL('image/jpeg', 0.85);
}

/* ================= 底部選單 ================= */
function sheet(html, setup) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  const close = () => bg.remove();
  bg.onclick = (e) => { if (e.target === bg) close(); };
  $('sheetRoot').appendChild(bg);
  setup && setup(bg, close);
}

/* ================= 啟動 ================= */
resetComposer();
renderMe();

/* ================= 離線快取（秒開） ================= */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
