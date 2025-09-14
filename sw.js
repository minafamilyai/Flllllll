const CACHE = 'onechat-v31.4';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=31.3',
  './app.js?v=31.3',
  './config.js',
  './manifest.json'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
});
self.addEventListener('fetch', e=>{
  const r = e.request;
  e.respondWith(
    caches.match(r).then(res => res || fetch(r).then(resp=>{
      const cp = resp.clone();
      caches.open(CACHE).then(c=>c.put(r, cp));
      return resp;
    }))
  );
});
