/*
 * Service Worker – wird nur für die Benachrichtigungen gebraucht
 * (Knöpfe „Erledigt“ / „In 1 Std. erneut“ direkt im Windows-Pop-up).
 * Es wird bewusst nichts zwischengespeichert, damit immer die aktuelle Version geladen wird.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const action = e.action || 'open';
  const id = (n.data && n.data.id) || '';
  n.close();

  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => c.url.startsWith(self.registration.scope)) || all[0];
    if (client) {
      client.postMessage({ type: 'notification-action', action, id });
      if (action === 'open') { try { await client.focus(); } catch (_) { /* egal */ } }
      return;
    }
    // App ist nicht geöffnet -> öffnen und Aktion über die Adresse mitgeben
    const params = new URLSearchParams({ task: id, action });
    await self.clients.openWindow(`${self.registration.scope}#${params}`);
  })());
});
