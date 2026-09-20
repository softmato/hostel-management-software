# Web push (browser) + wider notification coverage — DONE

Everything already funnelled through `notification.service.ts →
publishNewNotification → dispatchPush`. That chokepoint is why "also send it to
the browser" was a transport change, not a change to eighteen call sites.

## Phase W — the browser transport

- [x] W1 `DeviceToken` carries a web-push subscription (endpoint in `token`,
      plus `keys.p256dh` / `keys.auth`, `userAgent`, `expirationTime`). One
      collection for both transports, so sign-out, account-purge, the
      preference filter and dead-endpoint pruning are not duplicated.
- [x] W2 `web-push` dependency, VAPID env vars, `npm run web:generate:vapid`.
- [x] W3 `web-push.service.ts` — VAPID config, encrypt, send, report 404/410.
- [x] W4 `web-routing.ts` — role-aware `webLinkForNotification`.
- [x] W5 `push.service.ts` fans out to both transports from one audience.
- [x] W6 `/api/v1/push/{public-key,subscribe,unsubscribe,status}`.
- [x] W7 `public/sw.js` — push, notificationclick, pushsubscriptionchange.
      No fetch handler and no caching, on purpose.
- [x] W8 Client: `web-push-client.ts`, the toggle in the header bell, a silent
      resync on mount, and release-on-sign-out.
- [x] W9 Tests: routing table, two-transport fan-out, pruning, concurrency.

## Phase N — the events that never notified anybody

- [x] N1 hostel → service provider: a maintenance job assigned to them.
- [x] N2 hostel ↔ provider: status moved either way; a provider note.
- [x] N3 resident → hostel: a resident posted or updated a review.
- [x] N4 resident ↔ guardian: invitation accepted, permissions changed, access
      revoked.
- [x] N5 hostel ↔ kitchen: the weekly menu changed; a resident rated a meal 2
      or below.
- [x] N6 hostel → warden: added, permissions changed, suspended.
- [x] N7 system → all: `dispatchCampaign` sent no push at all — the one channel
      built for "everybody needs to know this" could not interrupt anyone.

## Left for the operator

- Generate a production VAPID pair (`npm run web:generate:vapid`) and set
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. A dev
  pair is already in the local `.env`. Rotating the pair orphans every existing
  browser subscription, so mint the production one once and keep it.
