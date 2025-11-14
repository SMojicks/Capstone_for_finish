const CACHE_NAME = 'cafesync-employee-v1';
// Add all critical files your EmployeeUI needs to run
const FILES_TO_CACHE = [
  'index.html',
  'style.css',
  'app.js',
  '../scripts/firebase.js',
  '../scripts/advanced-pos.js',
  '../scripts/inventory.js',
  '../scripts/inventory-categories.js',
  '../scripts/transaction.js',
  '../scripts/employee-reservations.js',
  '../scripts/employee-feedback.js',
  '../scripts/analytics.js',
  '../scripts/account-management.js'
  // Add key images/icons if necessary
];

// 1. On install, cache all critical assets
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching offline page');
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. On activate, clean up old caches
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[ServiceWorker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// 3. On fetch, serve from cache first (Cache-First Strategy)
self.addEventListener('fetch', (evt) => {
  // Don't cache Firestore requests
  if (evt.request.url.includes('firestore.googleapis.com')) {
    evt.respondWith(fetch(evt.request));
    return;
  }

  evt.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(evt.request)
        .then((response) => {
          // Return from cache or fetch from network
          return response || fetch(evt.request);
        });
    })
  );
});