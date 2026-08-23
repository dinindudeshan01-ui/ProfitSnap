# ProfitSnap — Native Android (offline-first)

This is a **real native Kotlin + Jetpack Compose app** — not the Capacitor/WebView
wrapper in `../android`. It has its own local database (Room) and syncs to the
same Supabase backend the web app uses.

## What this is NOT
`../android` is a Capacitor TWA — it just loads the Next.js web app in a WebView.
It's online-only. This folder is a ground-up separate app that works fully offline
and syncs when connectivity returns. Both can coexist in this repo; nothing here
touches the web app or the Capacitor build.

## Setup (do this first, in Android Studio)

1. Open `android-native/` as a project in Android Studio (Hedgehog/2023.1+, or
   newer — needs AGP 8.6+, which Studio will prompt to install if missing).
2. Studio will regenerate the Gradle wrapper automatically on first sync. I
   couldn't ship `gradle-wrapper.jar` from this environment (no network access
   to `services.gradle.org` in the sandbox that built this) — if Studio doesn't
   offer to fix it, run `gradle wrapper --gradle-version 8.9` once you have
   Gradle installed locally, or just let Studio's bundled Gradle sync it.
3. Create `android-native/local.properties` (gitignored, never commit it) with:
   ```
   SUPABASE_URL=https://your-actual-project.supabase.co
   SUPABASE_ANON_KEY=your-actual-anon-key
   ```
   These get read into `BuildConfig.SUPABASE_URL` / `BuildConfig.SUPABASE_ANON_KEY`
   at build time — same values as `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the web app's `.env.local`.
4. Build → Run. First screen is a login (email/password against your existing
   Supabase Auth users — same accounts as the web app).

## Architecture — how offline-first + auto-sync actually works here

```
UI (Compose)  →  Repository  →  Room (local DB, source of truth)
                       ↓
                 SyncWorker (WorkManager)  →  Supabase (PostgREST + GoTrue)
```

- **Every write goes to Room first.** `ProductRepository.addProduct()`,
  `SaleRepository.recordSale()`, etc. insert into the local SQLite DB and mark
  the row `PENDING` — that's the entire write, from the UI's perspective, and
  it works with zero connectivity.
- **The UI never waits on the network.** Every screen observes a Room `Flow`
  (see `HomeScreen`'s product count) — Room emits instantly on any local write.
- **Sync is a separate, best-effort background step.** `SyncEngine.runFullSync()`
  pushes every `PENDING` row to Supabase (respecting FK ordering — products
  before sales/stock_in/credit_sales, since those need a product's *remote* id),
  then pulls the products table back down so edits made on the web app show up
  here too.
- **Auto-sync triggers:** `NetworkMonitor` (in `ProfitSnapApp`) fires a sync the
  instant the device reconnects; every repository write also calls
  `SyncWorker.triggerImmediateSync()` right after its local write; and a
  15-minute periodic `WorkManager` job is the safety net underneath both.
- **Nothing is ever lost.** If a sync attempt fails (dead connection mid-push,
  expired token), the worker returns `Result.retry()` — the rows stay `PENDING`
  in Room and go out again next attempt. The local write already succeeded, so
  the user was never blocked or shown an error for something that will resolve
  itself once online.

## What's built (v1 scaffold)

- Room schema: `products`, `sales`, `stock_in`, `customers`, `credit_sales`
  (mirrors the Supabase schema field-for-field)
- Full push-sync for all 5 tables, pull-sync for `products` (see
  `SyncEngine.kt` for why pull is products-only in v1 — easy to extend)
- Auth (GoTrue email/password, persisted session via DataStore)
- Home screen wired to live Room data
- Nav graph with Sales/Stock/Profit/Items/Credit routes stubbed as placeholders

## What's NOT built yet — next steps, in priority order

1. **Sales screen** — `SaleRepository.recordSale()` already exists; just needs
   a product picker + qty input UI, same shape as `LoginScreen`.
2. **Stock In screen** — same pattern, needs a `StockInRepository`
   (doesn't exist yet — copy `SaleRepository`'s structure).
3. **Items screen** — list + add/edit against `ProductRepository`.
4. **Credit Sales screen** — port the web app's `ItemPicker` concept
   (search-or-create-inline) as a Compose equivalent; needs a
   `CreditSaleRepository`.
5. **Profit screen** — read-only aggregation query over `sales`/`stock_in`.
6. **Scan/OCR** — reuse the existing server-side `/api/scan` Gemini route
   (`POST` the photo as base64, same contract the web app already uses) rather
   than reimplementing OCR on-device. Needs a CameraX capture screen (the
   CameraX dependency is already in `build.gradle.kts`) + a Retrofit call to
   your Next.js API.
7. **Pull-sync for customers/credit_sales/sales/stock_in** — currently only
   `products` pulls down remote changes; extend `SyncEngine.pullCustomers()`
   etc. following the `pullProducts()` pattern once multi-device usage (e.g.
   staff phone + owner's web dashboard editing the same tenant concurrently)
   is a real scenario worth the added sync cost.
8. **Conflict handling** — v1 is last-write-wins on pull. Fine for a single
   shop owner's usage pattern; revisit if two staff devices start editing
   the same row offline at the same time.
