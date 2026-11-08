// 快取網頁本身和 Firebase 程式庫，下次打開幾乎是秒開。
// 資料（Firestore）不經過這裡，由 Firebase 自己的離線快取處理。
const CACHE = 'life-v2';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isLib = url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (sameOrigin && url.pathname.startsWith('/.netlify/')) return;
  if (!sameOrigin && !isLib) return;
  if (isLib) {
    // 程式庫和字型：版本固定，有快取就直接用
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
    return;
  }
  // 自己的檔案：先給快取（秒開），同時在背景抓新版，下次打開就是新的
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
