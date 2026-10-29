/* 沖縄 台風・交通: offline support. Upload once; never needs changing.
   Always fetches the newest index.html when online, so updating only the HTML is enough. */
const C='okt-app-3120';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-512.png','./icon-192.png','./apple-touch-icon.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>Promise.all(FILES.map(f=>c.add(new Request(f,{cache:'reload'})).catch(()=>{})))))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
 e.respondWith(fetch(r,{cache:'no-store'}).then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp))}return res})
  .catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||(r.mode==='navigate'?caches.match('./index.html').then(x=>x||caches.match('./')):undefined))))});
