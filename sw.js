// Service worker do link web do Corretor Unificado.
// ATENÇÃO: o GitHub Pages serve todos os repositórios da conta na MESMA origem
// (yurirodan.github.io). Por isso o nome do cache tem prefixo próprio
// ("skl-unificado-") e a limpeza só apaga caches com esse prefixo — nunca mexe
// nos caches de outros sites da mesma conta (que usam outros nomes).
const CACHE_PREFIX = "skl-unificado-";
const CACHE_NAME = CACHE_PREFIX + "v5";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./web.js",
  "./logo.png",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./vendor/supabase/supabase.js",
  // Vendas guardado já na instalação: o corretor abre o mapa sem internet no empreendimento.
  "./www-vendas/index.html",
  "./www-vendas/styles.css",
  "./www-vendas/app.js",
  "./www-vendas/online.js",
  "./www-vendas/vertical.js",
  "./www-vendas/simulador.js",
  "./www-vendas/data/lotes.js",
  "./www-vendas/data/status-config.js",
  "./www-vendas/vendor/leaflet/leaflet.css",
  "./www-vendas/vendor/leaflet/leaflet.js",
  "./www-vendas/vendor/supabase/supabase.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return;
  // só cuida do que é deste site (Supabase, mapas e satélite passam direto)
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL("./", self.location.href).pathname)) return;

  // "cache: no-store": o GitHub Pages manda Cache-Control: max-age=600; sem isso o
  // navegador pode responder do cache HTTP mesmo pedindo a rede "primeiro" e o corretor
  // ficaria vendo uma versão antiga do app depois de uma atualização.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request.url, { cache: "no-store" }).catch(() => caches.match(request).then((r) => r || caches.match("./index.html"))),
    );
    return;
  }

  event.respondWith(
    fetch(request.url, { cache: "no-store" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
