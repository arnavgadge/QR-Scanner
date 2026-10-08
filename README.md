# Serial Scanning & Label System

**Team Vicimus — Industry Project 2**

## Objective

A web application for a mechanical hardware company that engraves a unique serial number on every product. Operators enter or photograph a serial, the system verifies it against one shared source of truth (Firestore), flags duplicates, registers new serials, and prints a barcode or QR label depending on company configuration. It must work on desktop (primary, ~400–600+ serials/day, 4–6 operators) and mobile browsers (secondary, photo-based capture).

## Current phase

**Phase 9 — Admin dashboard + administration**, **Phase 8 — Browser label printing**, **Phase 7 — Barcode/QR generation + label preview**, **Phase 6 — Photo OCR with human confirmation**, **Phase 4 — Admin Excel import (safe merge)** and **Phase 5 — Admin Excel export**, on top of Phase 3 (manual verification + atomic registration), Phase 2 (auth/Firestore), Phase 1 (operator UI) and Phase 0 (foundation).

Implemented: email/password login/logout, persistent sessions, role lookup from `users/{uid}`, role-based routing, Firestore data model + security rules, companies and recent scans loaded from Firestore, emulator support, dev seed script, rules tests.

Implemented in Phase 3: an operator enters a serial manually, it is normalized and validated against the selected company's `serial_format`, then registered with a single Firestore **transaction** that either creates the serial + a `new` scan log, or only a `duplicate` scan log. The UI shows a green "New Serial Registered!" or a red "Duplicate Serial — send for re-engraving" screen (with the previous record vs. the current attempt) and refreshes Recent Scans. Database failures show "Not verified" and never report a serial as new.

Implemented in Phase 5: **admin-only Excel export** at `/admin/export`. It reads the complete `serials` collection from Firestore (server-only reads, paged by document ID, never the Recent Scans query) plus `companies`, and downloads `serial-label-export-YYYY-MM-DD.xlsx` with two sheets: **Serial Records** (Serial Number, Part Number, Company, Company ID, Code Type, Source, Registered At (UTC), Registered By; sorted by company then serial; frozen, filtered header) and **Export Summary** (export time/admin, totals, counts by company, source and code type). Serial cells are stored as text, so leading zeros, long numeric serials and values like `1E5` are never altered. All timestamps are UTC. The file is generated in the browser with [ExcelJS](https://github.com/exceljs/exceljs) (loaded on demand) and is not stored anywhere. Authorization is enforced by the Firestore rules (only admins may list `serials`).

Implemented in Phase 4: **admin-only Excel import** at `/admin/import`. Flow: choose an `.xlsx` → parsed locally in the browser (ExcelJS) → validated, normalized, in-file duplicates detected → each unique serial is compared with Firestore by direct document-ID lookups (30 IDs per query, never a full read) → **preview** with counts and expandable details → the admin must click **Import N New Records** → new serials are created with `source: "excel"` and server timestamps → an entry is appended to `import_history` and shown in the history list (also at `/admin/history`).

- **Columns (first row, first sheet; a sheet named "Serial Records" is preferred):** `Serial Number`, `Part Number`, `Company` (name or id) and/or `Company ID` are required headers; matching ignores case/spaces/punctuation; other columns (Code Type, Source, Registered At…) are ignored, so a Phase 5 export can be re-imported as-is. A missing required column rejects the whole file before any Firestore access. Only `.xlsx` is supported (max 25 MB / 50,000 rows).
- **Row classes** (every row gets exactly one): **New** · **Existing / skipped** (Firestore agrees) · **Conflict** (serial exists but company or part number differs — never written) · **Invalid** (missing/malformed data, unknown/inactive company, inexact numeric cell…) · **Duplicate within upload** (same serial again in the file; only the first occurrence counts). A blank part number in the file never conflicts.
- **Never overwrites.** The write step re-reads every serial inside a Firestore transaction (25 per transaction) and creates it only if still absent; a serial registered after the preview is skipped (or counted as a conflict) and reported. The security rules also make serial creation create-only.
- **Normalization:** same as manual entry (trim + upper-case); look-alike characters are never changed. The company's `serial_format` is **not** enforced on import (legacy data may predate it); manual entry still enforces it.
- **Who is "Registered By":** imported records use the importing admin's name; no scan log entries are created (an import is not a scan).
- **History:** only confirmed imports are recorded (filename, administrator, server time, total, new, skipped, conflicts, duplicates, invalid, status). The workbook itself is never stored. An import with 0 new records cannot be confirmed, so it leaves no history entry.
- A dev/test fixture can be regenerated with `node scripts/make-import-fixture.mjs` (`tests/fixtures/import-sample.xlsx`: new, existing, duplicate, conflict and invalid rows against the `seed:dev` data).
- **Timestamps:** the app UI shows the viewer's local time; the Excel export and its summary are labelled **UTC** (Firestore server time). No application timezone setting exists, so UTC is kept and labelled rather than silently converted.

Implemented in Phase 6: **photo OCR as a second INPUT method** (manual entry stays the default). On the scan screen choose **Upload Photo (OCR)** → take or choose a photo (guide box + quality tips; on phones "Take Photo" opens the rear camera) → preview with Read Serial / Retake / Cancel → OCR → **"Detected Serial"**, an editable field → the operator must press **Confirm & Check**. Nothing is ever registered automatically, even for a high-confidence reading. The confirmed value goes through the **same** `verifyAndRegisterSerial` as manual entry (same normalization, same company format validation, same atomic Firestore transaction, same new/duplicate screens); only `source` differs (`scan` instead of `manual`). Tests assert there is exactly one call site for verification.

- **OCR provider: [Tesseract.js](https://github.com/naptha/tesseract.js)** (open-source, runs in the browser in a Web Worker; photos never leave the device and are never stored: the preview is an in-memory object URL released when the workflow leaves the photo). The worker, engine core and English language data are **self-hosted** from `public/tesseract/`, copied by `scripts/copy-ocr-assets.mjs` (runs on `npm install` via `postinstall`; the folder is git-ignored), so OCR needs no third-party service and works offline. The engine is loaded on demand (not in the main bundle).
- **Architecture:** `src/services/ocr/` has the provider-independent `OCRService.recognize(image)` interface and `OCRResult` (`text`, `rawText`, optional `confidence`, `provider`, `candidates`); `tesseractOcr.ts` is the adapter (image preprocessing lives here: EXIF orientation, downscale, grayscale, mild contrast stretch; no binarization). It knows nothing about companies, Firestore or verification. `candidate.ts` picks the most serial-like fragment. Swap providers in `getOcrService()` only.
- **Confidence:** only the engine's own 0–100 value is ever shown; if a provider reports none the UI says so. Thresholds are in `src/config/ocr.ts` (`OCR_CONFIDENCE`: high ≥ 85, medium ≥ 65, else low): **high** = normal confirmation; **medium** = amber warning and the operator must tick "I compared this serial with the engraving"; **low** = red warning, "Retake Photo" becomes the main action and confirming needs the tick plus "Confirm anyway". These thresholds are placeholders to tune on real factory photos.
- **Look-alike characters** are never changed automatically. If the reading has the right length and only well-known look-alike mismatches against the company format (letter O where a digit is required, etc.), a _suggested fix_ button is offered; the operator chooses it and still confirms.
- **Errors:** nothing readable / provider failure / unreadable image → "Couldn't reliably read a serial number from this photo." with Retake Photo and Enter Manually; nothing is registered. If the camera does not open or is denied (browsers report this only as a cancelled picker) a notice points to Choose Photo and Enter Manually.
- **Development mock (never the production default):** run the dev server with `VITE_OCR_PROVIDER=mock` to exercise every branch without real photos. The mock reads a scenario from the **file name**: `mock-high-<SERIAL>.png`, `mock-medium-…`, `mock-low-…`, `mock-noconf-…`, `mock-none.png`, `mock-noise.png`, `mock-error.png`, `mock-slow-<SERIAL>.png`. It is labelled in the UI and is stripped from production builds.

Implemented in Phase 7: **barcode and QR code generation + label preview.** When a serial is registered as **new** (manual or photo/OCR; both go through the same verification), the result screen shows a label whose code type comes **only from the selected company's `code_type`**: `barcode` → Code 128 barcode label, `qr` → QR label. Operators have no control to choose or override it, and the type is never inferred from the serial. A **duplicate never gets a label**.

- **Libraries:** [JsBarcode](https://github.com/lindell/JsBarcode) (Code 128: encodes any printable-ASCII serial) and [`qrcode`](https://github.com/soldair/node-qrcode) (error correction M). They are used only in `src/services/printing/codeGenerator.ts`, which returns plain vector geometry (no DOM, no Firestore) that React renders as inline SVG. Tests decode the output with the independent ZXing decoder (`@zxing/library`, dev-only), including the code as actually rendered on screen.
- **Separate steps:** registration (Phase 3, Firestore) → code generation (`generateCode`) → label rendering (`BarcodeLabel` / `QRCodeLabel`) → printing (Phase 8). Nothing about the code is stored in Firestore: the label is derived from the verified result (`buildLabelData`) when needed. If code generation fails the screen says "Unable to generate label code." with Retry; the serial stays registered and Retry never registers again.
- **Encoded values:** barcode = the serial; QR = the serial (initial payload). Both are isolated in `src/services/printing/labelPayload.ts` so they can change without touching UI or generator. The serial is always also shown as real text, plus company, part number (`—` when none is known; never invented) and the verified timestamp.
- **Label size:** development preview only: 70 × 35 mm in `src/config/label.ts` (the real stock/printer is undecided). Label contents are sized in container units relative to the label's own width, so the same components scale to any width (the print copy uses the real width in mm, see Phase 8 below).
- **Company configuration:** `/admin/companies` lets an admin set each company's code type (Barcode / QR); only admins can write companies (Firestore rules). A company whose `code_type` is missing or unsupported is **listed as "Not configured"**, shows "Company code type is not configured.", and **cannot register serials** (blocked before any write, for manual and photo), so no serial is consumed without a way to label it.

Implemented in Phase 8: **browser label printing** (no printer agent). The label preview for a NEW serial has a **Print Label** button (after the first request it reads **Print Again**); duplicates never show it. It calls `printLabel()` in `src/services/printing/printService.ts`, the only place that calls `window.print()`.

- **Print only the label:** the same `BarcodeLabel` / `QRCodeLabel` components (same data, same generated code) are rendered a second time at the real size in a hidden `.label-print-root` outside the app (`PrintableLabel`). While a label print is in progress the service sets `body.label-printing`; `src/styles/print.css` then hides everything except that element, and a temporary `@page { size: <label size>; margin: 0 }` (built from `LABEL_SIZE_MM`) is injected. Both are removed on `afterprint`. The rules are scoped to `body.label-printing`, so an ordinary Ctrl+P elsewhere is untouched.
- **Checks before the dialog:** label data exists, the print copy is rendered and matches the label's serial / code type / value, and `window.print` exists; otherwise nothing is printed and the screen says "Unable to prepare label for printing." Print preparation never touches Firestore: no registration, no serial lookup, no scan log.
- **Honest status:** the browser cannot say whether a printer produced a label, so the screen only ever says "Print dialog requested … check the printer" (never "printed"). The button is disabled only while the dialog is being opened (no double dialogs) and is available again for Print Again, which reuses the same label data.
- **Dimensions / printer settings** are in `src/config/label.ts`: `LABEL_SIZE_MM` (default 70 × 35 mm, development value) and `LABEL_PRINT_DPI` (default 203). In print, barcode and QR sizes are snapped to a whole number of printer dots per module (never stretched, no CSS scaling); the label itself is never scaled.
- Printing from a phone uses whatever the phone's browser supports; it is not a primary workflow.

Implemented in Phase 9: the **admin area** (`/admin/*`, admins only; operators see "Access denied" from the route guard **and** are refused by the Firestore rules). The admin shell is a sidebar on large screens and a collapsible menu on small ones: **VICIMUS / Serial Label System** · Dashboard · Import Excel · Export Excel · Companies · Users · Scan History · Operator view. Operators only see **Scan** and **Recent scans**. There are no Edit/Delete Serial controls anywhere: serials stay create-only and nothing is ever deleted (companies and users are deactivated, not deleted).

- **Dashboard (`/admin`)**: total registered serials, serials registered today, **duplicate attempts** today (scan attempts, not unique serials), companies (total / active), active operator accounts, a per-company serial count, and the latest scans / imports / exports (limited to 10 each). Every number is a Firestore **count aggregation** (`getCountFromServer`; no documents are downloaded) and each card loads independently, so one failure shows "Unavailable" + Retry instead of a fake value. "Active operators" means active operator _accounts_ (the app does not track who is online). A **Refresh** button re-reads everything.
- **Time zone convention**: "today" and the history date filters use the **admin's local calendar day** (the browser's zone, shown on the page, e.g. "Asia/Calcutta"); the UI displays local time. The Excel export is the one exception and is labelled **UTC**. Firestore stores absolute server timestamps. See `src/services/admin/dateRanges.ts`.
- **Companies (`/admin/companies`)**: list all companies (including inactive and "not configured" ones), **create**, **edit** (name, label code type Barcode/QR, serial format, active) and **deactivate/reactivate** with confirmation. Validation: name required (≤ 80), code type required, serial format required (≤ 100, no spaces or `/`). The company ID is derived from the name and never overwritten. Changing the code type affects **only labels for serials registered afterwards**: stored serials, scan history and printed labels are untouched. Deactivated companies disappear from the operator selector (operators load active companies only; they see the change on their next page load). Each change records who and when (`updated_by`, `updated_by_name`, `updated_at`; `created_by` on create).
- **Users (`/admin/users`)**: list name, email, role, status, created, last changed (and by whom). An admin can switch another user between **Operator ↔ Admin** and **Deactivate/Reactivate** (with confirmation). Roles are only `operator` and `admin`. No passwords, tokens or secrets are stored or shown; **accounts are still created in the Firebase console / Admin SDK** (a client app cannot create Auth accounts without signing the admin out), then given a `users/{uid}` profile.
  - **Limitation (important):** `active = false` blocks the person from **all application data** immediately (the Firestore rules require an active profile) and the app shows "account inactive", but it does **not** disable their Firebase Authentication account (they can still sign in). Disabling the Auth account needs the Firebase console or Admin SDK (a Cloud Function would be the way to automate it).
  - **Last-admin protection:** the rules forbid an admin from changing **their own** role or active status, so every change to an admin is made by a _different, still-active_ admin; the UI also refuses to demote/deactivate the last active administrator (stale-list case). The system therefore cannot lose its last active admin through the app. To promote the very first admin, use the console (see Firebase setup).
- **Scan History (`/admin/history`)**: three clearly separate tabs: **Scan history** (every scan _attempt_ from `scan_log`: time, serial, NEW/DUPLICATE, company, part number, source, scanned by), **Import history** and **Export history** (file, who, when, number of records; the export is recorded in `export_history` after a successful download). Scan history is **paginated** (25 per page, "Load more", cursor-based; never the whole collection) and filterable by result, company, source (manual / photo), operator and date range (start/end, local days). Part number is looked up from `serials` for the rows on the page. Responsive: a table on desktop, cards on phones.
- **Indexes**: filtered history queries need **composite indexes**, declared in `firestore.indexes.json` (generated by `node scripts/make-indexes.mjs`; one per combination of the four equality filters + `timestamp` descending). The emulator needs none. For a real project deploy them once: `npx firebase deploy --only firestore:indexes --project <your-project-id>` (building can take a few minutes; until then a filtered query fails with a "requires an index" error and the page shows its error state). A unit test checks that every filter combination has an index.
- **Rules (new)**: `users` updates may change only `role`/`active` (+ attribution fields), never `name`/`email`/`created_at`, and never your own account; `companies` writes are validated (known code type, bounded strings, attribution equals the caller, server timestamps, immutable `created_at`/`created_by`); `export_history` is admin-only, append-only and attributed. Note: `scan_log` stays readable by active staff because the operator "Recent scans" list is shared on the shop floor; only the admin history _UI_ is admin-only.
- **Testing**: `npm run test:rules` (security rules incl. unauthenticated / operator / admin / inactive / last-admin cases) and `npm test` (unit + emulator tests for dashboard counts, history paging and filters, company/user services, export history, architecture checks).

Phase 10 (multi-device, concurrency, failure and edge-case testing) found and fixed these defects; none affected registration atomicity:

- **Serial length limit:** serials are limited to **100 characters** (`MAX_SERIAL_LENGTH`; the `scan_log` rule enforces the same). Previously a longer serial on a company with no serial format passed the app's checks and was then refused by the rules on every attempt, so the operator saw a misleading "Not verified, try again". It is now rejected up front with a clear message, as are values that cannot be Firestore document IDs (`/`, `.`, `..`, `__x__`).
- **Company switched during OCR confirmation:** the "does not match this company's format" warning and the look-alike suggestion were snapshots from when the photo was read. They are now recomputed from the company selected now and the text in the field now (the serial was always verified against the company selected at confirm time).
- **Company deactivated while an operator is typing:** the operator was told "You do not have permission to register serials" (rules hide inactive companies from operators); they now get "Company configuration is unavailable".
- **No active company:** the operator screen now says so explicitly (with a Try again button) instead of a generic message.
- **Keyboard focus:** a freshly loaded scan page left the focus on the page body; the serial input is now focused as soon as the form appears.

Known limitations found by Phase 10:

- A 40-character Code 128 barcode is 330 modules wide; on the 70 mm development label at 203 dpi it prints at exactly 1 printer dot per module (about 0.125 mm, below the 0.19 mm many scanners need). The data is correct and nothing is truncated; choose the real label stock/printer and test-scan the longest serial before production. QR codes of the same serial are unaffected.
- (Corrected in Phase 11) Excel import did enforce the 100-character limit, but through a duplicated constant; it now uses the same shared validator as manual entry and OCR (`services/serial/serialValidation.ts`). Label limits (barcode 80 characters, ASCII) apply only to manual/OCR registration, because an import produces no label.
- Deactivating a user does not disable their Firebase sign-in (see Phase 9). The admin lock-out race (two admins demoting each other at once) was tested 50 times against the emulator's rules engine and never left zero active administrators; this is not a formal proof for production Firestore.

Phase 11 (production hardening, no deployment): shared serial validation for manual, OCR and Excel import; live profile subscription (deactivation/demotion applies to the open session); fail-closed production configuration (no emulator code or demo config in a production bundle, `npm run verify:bundle`; a `demo-` project id refuses to start); a `logError`/`logWarn` helper with short production logs; specific error messages; label size/DPI configurable (`VITE_LABEL_*`); 10 more rule tests (64 total) and new tests for partial import failure, time boundaries and bundle hygiene. Read the facts, limits and the deployment checklist in **docs/PRODUCTION_READINESS.md**; the full matrix is **docs/PHASE11_READINESS_MATRIX.md**; on-site work is in **docs/OCR_TEST_PROTOCOL.md** and **docs/PRINT_CALIBRATION.md**. The large-import slowness seen in the emulator is explained there (emulator query cost grows with collection size); confirm with a real-Firestore import during the pilot.

Intentionally **not** implemented (later phases): deployment, pilot rollout and reports.

### Serial rules (business decisions to confirm)

- **Uniqueness scope: global.** The serial is the Firestore document ID (`serials/{serial}`), so a serial is unique across all companies. This is isolated in `serialDocId` in `src/services/serial/serialRepository.ts`; making it per-company later means changing that function and the rules together.
- **Format convention (placeholder):** in `serial_format`, `#` = one digit and every other character is a literal (case-insensitive); the length must match exactly; an empty format accepts any non-empty serial. Sample formats: Company A `13WAA#########`, Company B `27BXX#######`. The real production formats are still to be confirmed.
- **Normalization:** trim surrounding whitespace and upper-case. Look-alike characters (O/0, I/1) are never altered. A serial is at most 100 characters and must be a valid Firestore document ID.
- Registration is by the signed-in operator only (UID and name come from Firebase Auth + `users/{uid}`, never from the UI). Source is `manual` for this workflow.

## Tech stack

React 19 · Vite · TypeScript (strict) · Tailwind CSS v4 · React Router · Firebase Web SDK (Auth + Firestore) · ESLint + Prettier.

## Commands

```
npm install
npm run dev         # dev server
npm run build       # type-check + production build
npm run lint        # ESLint
npm run emulators   # local Auth + Firestore emulators (needs Java 21+)
npm run seed:dev    # seed the emulators with dev data (emulators must be running)
npm run test:rules  # Firestore security-rules tests (needs Java 21+; starts the emulator itself)
npm test            # service tests: format, verification, concurrency (needs Java 21+; starts the emulator)
```

## Environment variables

Copy `.env.example` to `.env.local` (git-ignored). If any are missing the app shows a configuration screen listing them.

| Variable                            | Description                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `VITE_FIREBASE_API_KEY`             | Firebase web API key                                                                                                       |
| `VITE_FIREBASE_AUTH_DOMAIN`         | Auth domain                                                                                                                |
| `VITE_FIREBASE_PROJECT_ID`          | Project id                                                                                                                 |
| `VITE_FIREBASE_STORAGE_BUCKET`      | Storage bucket                                                                                                             |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Messaging sender id                                                                                                        |
| `VITE_FIREBASE_APP_ID`              | Web app id                                                                                                                 |
| `VITE_USE_FIREBASE_EMULATOR`        | Optional, dev server only. `true` = use local emulators; the values above may then be empty. Ignored in production builds. |

Firebase web config identifies the project; it is not a secret. Access control is Auth + `firestore.rules`. Never put service-account keys or other secrets in `VITE_*` variables. In production, set the same variables in the build environment (Vite inlines them).

## Firebase setup (real project)

1. Create a Firebase project; add a Web app and copy its config into `.env.local`.
2. Authentication → Sign-in method → enable **Email/Password**.
3. Create Firestore (production mode), then deploy the rules: `npx firebase deploy --only firestore:rules --project <project-id>`.
4. **Create the first admin manually** (the rules deliberately prevent clients from creating users): create the account under Authentication → Users, copy its UID, and in Firestore create `users/<uid>` with `name`, `email`, `role: "admin"`, `active: true`, `created_at` (timestamp). Add companies (`companies/<id>`) the same way until the Phase 9 admin UI exists.
5. A signed-in account with no `users/<uid>` document, or with `active: false`, gets no access.

## Local development with emulators (no real Firebase needed)

```
# .env.local
VITE_USE_FIREBASE_EMULATOR=true

npm run emulators   # terminal 1  (Auth :9099, Firestore :8080, UI :4000)
npm run seed:dev    # terminal 2  (emulator only; refuses to touch a real project)
npm run dev         # terminal 3
```

Seeded dev accounts (emulator only): `admin@example.test` and `operator@example.test`, password `devpassword123`. The seed creates Company A (barcode), Company B (QR), one serial and a few scan-log entries. Seeding is never run automatically.

## Data model (Firestore)

| Collection       | Document ID           | Fields                                                                                                                             |
| ---------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `users`          | Firebase UID          | `uid, name, email, role (operator\|admin), active, created_at` (+ `updated_at, updated_by, updated_by_name` after an admin change) |
| `companies`      | company id            | `id, name, code_type (barcode\|qr), serial_format, active, created_at, updated_at, created_by, updated_by, updated_by_name`        |
| `serials`        | **the serial itself** | `serial, part_no, company, company_id, source (excel\|manual\|scan), scanned_at, scanned_by, scanned_by_name`                      |
| `scan_log`       | auto id               | `serial, result (new\|duplicate), company, company_id, source, scanned_by, scanned_by_name, timestamp`                             |
| `import_history` | auto id               | filename, administrator, server time, total/new/skipped/conflicts/duplicates/invalid, status                                       |
| `export_history` | auto id               | `filename, exported_by, exported_by_name, exported_at, record_count`                                                               |

Using the serial as the document ID makes uniqueness a direct document operation. Authoritative timestamps are server timestamps. Barcode/QR are label **output** formats, not input modes. Firestore documents are converted to app types (camelCase, ISO-string timestamps) only in `src/services/firebase/converters.ts`.

## Security rules summary (`firestore.rules`)

Default deny. Roles come from `users/{uid}`; `isAdmin()/isOperator()/isStaff()` require an existing, active profile.

| Collection                         | Operator                                                                                                                                                                                                                                 | Admin                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `users`                            | read own profile                                                                                                                                                                                                                         | read all; update **other** users' role/active only (attributed); create; never delete |
| `companies`                        | read active only                                                                                                                                                                                                                         | read all; validated, attributed create/update; never delete                           |
| `import_history`, `export_history` | none                                                                                                                                                                                                                                     | read, append attributed entries; never update/delete                                  |
| `serials`                          | `get` one by ID; no list; **create-only**, strictly validated (own UID + stored name, server timestamp, active company with matching name, `manual`/`scan` source); never update/delete                                                  | list/get; may create like an operator; never update/delete                            |
| `scan_log`                         | read; append a self-attributed entry with server timestamp that the database backs up: a `new` log is only accepted in the same commit that creates its serial, a `duplicate` log only if the serial already exists; never update/delete | same                                                                                  |

Route guards in the UI are convenience only; the rules are the enforcement. Rules are evaluated before Firestore's contention handling, so a device that loses a race gets `permission-denied` on its first commit (its create now looks like an update). `registerOrDetectDuplicate` re-runs the transaction, which then takes the duplicate path; the browser console may show a 403 for that first attempt. If the network drops mid-check, the operator sees "Not verified" after about 15–17 s (Firestore's transaction timeout).

## Folder structure

```
src/
├── app/            App, router, providers, config-missing screen
├── components/     ui/ (Button, TextField) · common/ (LoadingState, ErrorNotice, AccessDenied…)
├── features/       auth (provider, guards) · companies (shell, info card) · operator · serial · ocr · printing · admin
├── hooks/          useAuth · useUser · useCompanies · useRecentScans
├── layouts/        OperatorLayout · AdminLayout · AuthLayout
├── pages/          operator/ · admin/ (lazy-loaded) · auth/
├── services/       firebase (client, auth, firestore, converters) · users · companies · scans · serial · ocr · excel · printing
├── types/  utils/  config/  styles/
firestore.rules · firebase.json · firestore-tests/ · scripts/seed-dev.mjs
```

Components never contain Firestore queries; they use hooks, which call services. Firebase is initialized once in `services/firebase/client.ts` (app → auth → firestore).

## Routes

Public: `/login`. Signed-in operators and admins: `/`, `/scan`, `/history` (Recent scans). Admins only: `/admin`, `/admin/import`, `/admin/export`, `/admin/companies`, `/admin/users`, `/admin/history` (others see "Access denied").

## Future phases

3. Manual serial verification + atomic Firestore registration — **done**
4. OCR photo capture
5. Excel import/export/reconciliation
6. Barcode/QR generation and printing
7. Admin workflows (users, companies, history) — **done (Phase 9)**
8. Hardening: load/concurrency tests, deployment, pilot
