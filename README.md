# Serial Scanning & Label System

**Team Vicimus — Industry Project 2**

## Objective

A web application for a mechanical hardware company that engraves a unique serial number on every product. Operators enter or photograph a serial, the system verifies it against one shared source of truth (Firestore), flags duplicates, registers new serials, and prints a barcode or QR label depending on company configuration. It must work on desktop (primary, ~400–600+ serials/day, 4–6 operators) and mobile browsers (secondary, photo-based capture).

## Current phase

**Phase 2 — Firebase Authentication + Firestore foundation** (on top of Phase 0 foundation and Phase 1 operator UI).

Implemented: email/password login/logout, persistent sessions, role lookup from `users/{uid}`, role-based routing, Firestore data model + security rules, companies and recent scans loaded from Firestore, emulator support, dev seed script, rules tests.

Intentionally **not** implemented (Phase 3+): atomic serial registration, real duplicate detection, writing `scan_log`, OCR, Excel, barcode/QR generation, printing, admin management UIs. The scan screen's "check" still runs against an in-memory mock (`services/serial/mockSerialService.ts`, `services/ocr/mockOcr.ts`) and saves nothing.

## Tech stack

React 19 · Vite · TypeScript (strict) · Tailwind CSS v4 · React Router · Firebase Web SDK (Auth + Firestore) · ESLint + Prettier.

## Commands

```
npm install
npm run dev         # dev server
npm run build       # type-check + production build
npm run lint        # ESLint
npm run emulators   # local Auth + Firestore emulators (needs Java)
npm run seed:dev    # seed the emulators with dev data (emulators must be running)
npm run test:rules  # Firestore security-rules tests (needs Java; starts the emulator itself)
```

## Environment variables

Copy `.env.example` to `.env.local` (git-ignored). If any are missing the app shows a configuration screen listing them.

| Variable | Description |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Project id |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Messaging sender id |
| `VITE_FIREBASE_APP_ID` | Web app id |
| `VITE_USE_FIREBASE_EMULATOR` | Optional, dev server only. `true` = use local emulators; the values above may then be empty. Ignored in production builds. |

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

| Collection | Document ID | Fields |
| --- | --- | --- |
| `users` | Firebase UID | `uid, name, email, role (operator\|admin), active, created_at` |
| `companies` | company id | `name, code_type (barcode\|qr), serial_format, active, created_at, updated_at` |
| `serials` | **the serial itself** | `serial, part_no, company, company_id, source (excel\|manual\|scan), scanned_at, scanned_by, scanned_by_name` |
| `scan_log` | auto id | `serial, result (new\|duplicate), company, company_id, source, scanned_by, scanned_by_name, timestamp` |

Using the serial as the document ID makes uniqueness a direct document operation. Authoritative timestamps are server timestamps. Barcode/QR are label **output** formats, not input modes. Firestore documents are converted to app types (camelCase, ISO-string timestamps) only in `src/services/firebase/converters.ts`.

## Security rules summary (`firestore.rules`)

Default deny. Roles come from `users/{uid}`; `isAdmin()/isOperator()/isStaff()` require an existing, active profile.

| Collection | Operator | Admin |
| --- | --- | --- |
| `users` | read own profile | read all, create/update (no delete) |
| `companies` | read active only | read all, create/update (no delete) |
| `serials` | `get` one by ID; no list; no create (Phase 2), update or delete | list/get; no update or delete |
| `scan_log` | read; append self-attributed entry with server timestamp; never update/delete | same |

Route guards in the UI are convenience only; the rules are the enforcement. Phase 3 will add a strictly validated `serials` create used by the atomic registration transaction.

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

Public: `/login`. Signed-in operators and admins: `/`, `/scan`, `/history`. Admins only: `/admin`, `/admin/import`, `/admin/export`, `/admin/companies`, `/admin/users`, `/admin/history` (others see "Access denied").

## Future phases

3. **Phase 3** — Manual serial verification + atomic Firestore registration (normalize/validate → create-if-not-exists transaction → NEW/DUPLICATE → scan log)
4. OCR photo capture
5. Excel import/export/reconciliation
6. Barcode/QR generation and printing
7. Admin workflows (users, companies, history), hardening
