# ProfitSnap — Web (Next.js + Supabase)

This is the web port of the ProfitSnap mobile app. Same screens, same data
model, same OCR-powered bill-scanning flow — running as a single Next.js
app instead of an Expo app + separate Express backend.

## What changed vs. the original two-repo setup

| Before | Now |
|---|---|
| `profitsnap-expo` (Expo/React Native) | Next.js App Router, mobile-width layout |
| `profitsnap-backend` (Express + Gemini) | `/api/scan` Next.js API route |
| `expo-sqlite` (local, per-device) | Supabase Postgres (shared, multi-device-ready) |
| Local `expo-file-system` photo outbox | Supabase Storage (`scans` bucket) + `scan_log` table |
| No accounts | Still none — dev mode, single shared shop record (per current decision) |

The data model (`products`, `sales`, `stock_in`, `settings`) and all business
logic — weighted-average cost on stock-in, stock deduction on sale, OCR
schema per scan type — is ported field-for-field and formula-for-formula
from the original app. Profit/stock math will match exactly.

## Setup

### 1. Create a Supabase project
Go to supabase.com, create a project, then:

- **Run the schema**: open the SQL editor and run `supabase/schema.sql`,
  then `supabase/credit-engine-schema.sql` (adds the credit/wallet/refund
  tables — must run after the first file, not instead of it)
- **Create a Storage bucket** named `scans` (Storage -> New bucket). Keep it
  private — the app only ever uploads/reads via the service-role key from
  the server, never directly from the browser.

### 2. Get your API keys
In Supabase: Project Settings -> API. You need:
- Project URL
- `anon` public key
- `service_role` key (keep this server-side only — never expose to the browser)

### 3. Get a Gemini API key
aistudio.google.com -> Get API key. This powers the bill-scan OCR
(`/api/scan`), same model/prompting approach as the original backend.

### 4. Environment variables
Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINI_API_KEY=AIza...
```

### 5. Install & run

```bash
npm install
npm run dev
```

Open http://localhost:3000 — first run sends you to `/setup` (matches the
original onboarding flow), since `setupComplete` isn't set yet.

## Project structure

```
src/
  app/
    page.tsx              -> Home
    sales/page.tsx         -> Record sales
    stock/page.tsx         -> Stock-in
    profit/page.tsx        -> Profit dashboard
    items/page.tsx         -> Manage items
    setup/page.tsx         -> First-run onboarding
    scan/page.tsx          -> Camera scan flow (web getUserMedia)
    api/scan/route.ts      -> OCR endpoint (replaces Express /scan)
    api/scan/escalate/route.ts -> Staff-escalation logging
  components/
    screens/                -> One file per screen, ported from Expo screens
    ArcHeader, BottomSheet, BottomTabBar, FormField, UnitPicker, UnitIcon, Toast
  lib/
    db/queries.ts           -> Data access layer (port of db/queries.js)
    ocr/geminiService.ts    -> Gemini call + retry-with-backoff
    ocr/imageProcessing.ts  -> Server-side image compression (sharp)
    i18n/                   -> All 8 languages, ported 1:1 from langs.js
    supabase/               -> Browser + server (service-role) clients
    theme.ts                -> Brand colors, ported from tokens.js
supabase/schema.sql          -> Full Postgres schema + indexes
```

## Notes on the OCR pipeline

`/api/scan` mirrors the original backend almost exactly:
1. Receives a photo + `scanType` (`setup` | `stock_in` | `sales`)
2. Compresses/resizes it server-side (`sharp`) — same dimensions/quality as before
3. Sends it to Gemini with a **strict JSON schema per scan type** — this is
   what makes the output predictable (`{code, name, qty, cost, sell}`),
   unlike free-form "guess the columns" extraction
4. Added **retry with exponential backoff** on top of the original logic —
   the old Express backend had no retry, so a transient 429/5xx failed the
   whole scan. Now it retries up to 4 times before giving up.
5. Every scan attempt (success or failure) is archived to Supabase Storage
   + the `scan_log` table — this replaces the local device-only "outbox"
   folder, so staff can actually see failed scans and escalations.

## Credit system

Every scan costs credits, charged server-side before the Gemini call:
- **20 credits** (Rs 2.00) for the first photo of a scan
- **+5 credits** (Rs 0.50) for each retake after that
- Charged even if OCR fails — the Gemini API call costs money the moment
  it's made, regardless of outcome

After saving a scan's rows, the user is asked whether the result was
correct. If not, a refund request is opened automatically and checked
against one fact the system can prove on its own: did this scan's rows
actually get saved into products/sales/stock_in? That flag
(`scan_log.rows_committed`) is set in exactly one place — the real save
path — so it can't be set by anything else, including a tampered client
request.

- Charged but never saved → refunded instantly, no admin needed
- Charged and saved → routed to admin for manual review (the data might
  still be wrong, but that's a quality judgment call, not a provable
  non-delivery)

The `/credits` page shows balance, a testing-only top-up button (stands in
for a real payment gateway), and full transaction history with an
expandable breakdown per scan. See `src/lib/credits/engine.ts` for the
charge/refund logic — it's the only file allowed to move credits, and it
uses the service-role Supabase client, so it must never be imported into
a client component.

## Known gaps / things to revisit before the Expo rebuild

- **No auth yet.** Per the current decision, this is dev-mode/single-shop.
  Before going multi-device on Android, add Supabase Auth + a `shop_id`
  column + RLS policies (the schema has a comment marking exactly where).
- **Backup button on Home is a placeholder.** The original app's backup
  flow wasn't part of this port's scope — wire it to a real
  export/Supabase-backup action when needed.
- **Camera flow uses `getUserMedia`**, which works in any modern mobile
  browser, but isn't the same API surface as `expo-camera`. When you move
  to the Expo rebuild, the screens stay the same — only the camera capture
  and the Supabase calls (already isomorphic JS) need touching.
