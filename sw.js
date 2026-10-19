// 通信できるときは必ず最新を取りにいき、通信できないときだけ前回の内容を出す
const C = 'okt-live-v1';
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => c.addAll(['./', 'index.html']).catch(() => {})));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  const key = u.origin + u.pathname;
  e.respondWith(
    fetch(r, { cache: 'no-store' }).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(key, cp)); }
      return res;
    }).catch(async () => {
      const m = await caches.match(key);
      if (m) return m;
      if (r.mode === 'navigate') return (await caches.match(u.origin + '/index.html')) || (await caches.match(u.origin + '/')) || Response.error();
      return Response.error();
    })
  );
});
