// 서비스 워커 — 오프라인 캐시. 데이터는 캐시하지 않고(앱은 localStorage 사용),
// 앱 셸(HTML/CSS/JS/아이콘)만 캐시해 인터넷 없이도 앱이 열리게 한다.
const CACHE = 'moneybook-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Anthropic API 등 외부 호출은 절대 캐시하지 않고 네트워크로 직행
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  // 앱 셸: 캐시 우선, 없으면 네트워크 후 캐시에 저장
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => cached)
    )
  );
});
