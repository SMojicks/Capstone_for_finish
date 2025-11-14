// Use a new version name to force the service worker to update
const CACHE_NAME = 'cafesync-employee-v5';

// 1. Use root-absolute paths (starting with /)
// This assumes your server root is the 'Capstone-6c7691011b2317fc712d3f24d66c23bab040b3b8' folder
const LOCAL_FILES_TO_CACHE = [
  '/EmployeeUI/index.html',
  '/EmployeeUI/style.css',
  '/EmployeeUI/app.js',
  '/scripts/firebase.js',
  '/scripts/advanced-pos.js',
  '/scripts/inventory.js',
  '/scripts/inventory-categories.js',
  '/scripts/transaction.js',
  '/scripts/employee-reservations.js',
  '/scripts/employee-feedback.js',
  '/scripts/analytics.js',
  '/scripts/account-management.js'
];

const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'cdnjs.cloudflare.com',
  'fonts.gstatic.com'
];

// On install, cache all critical LOCAL assets
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker v5] Attempting to pre-cache local files...');
      
      // We wrap cache.addAll in its own promise to get better error logging
      return new Promise((resolve, reject) => {
        cache.addAll(LOCAL_FILES_TO_CACHE)
          .then(() => {
            console.log('[ServiceWorker v5] All local files cached successfully!');
            resolve();
          })
          .catch((error) => {
            console.error('[ServiceWorker v5] Cache install failed:', error);
            console.error('Failed to cache one of the files. Check paths in LOCAL_FILES_TO_CACHE.');
            reject(error); // Make sure the install fails if caching fails
          });
      });
    })
  );
  self.skipWaiting();
});

// On activate, clean up old caches (like v1, v2, v3, v4)
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[ServiceWorker v5] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// On fetch, use different strategies
self.addEventListener('fetch', (evt) => {
  const url = new URL(evt.request.url);

  // Strategy 1: Don't cache Firestore
  if (url.hostname.includes('firestore.googleapis.com')) {
    evt.respondWith(fetch(evt.request));
    return;
  }

  // Strategy 2: For CDN files (Stale-While-Revalidate)
  if (CDN_HOSTS.includes(url.hostname)) {
    evt.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(evt.request).then((cachedResponse) => {
          const fetchPromise = fetch(evt.request).then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
              cache.put(evt.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(err => {
            // Suppress offline fetch errors for background updates
          });

          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // Strategy 3: For all other (local) app files (Cache-First)
  evt.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(evt.request)
        .then((response) => {
          // Return from cache or fetch from network
          return response || fetch(evt.request).catch(err => {
            console.warn(`[ServiceWorker v5] Local file not in cache and offline: ${evt.request.url}`);
          });
        });
    })
  );
});