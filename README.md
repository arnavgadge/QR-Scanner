# Serial Scanning & Label System

**Team Vicimus — Industry Project 2**

## Objective

A web application for a mechanical hardware company that engraves a unique serial number on every product. Operators enter or photograph a serial, the system verifies it against one shared source of truth (Firestore), flags duplicates, registers new serials, and prints a barcode or QR label depending on company configuration. It must work on desktop (primary, ~400–600+ serials/day, 4–6 operators) and mobile browsers (secondary, photo-based capture).

## Current phase

**Phase 0 — project foundation.**

> Phase 0 establishes the project foundation. Business functionality will be implemented in subsequent phases.

Implemented: tooling, routing skeleton with placeholder pages, route-guard boundaries, domain types, Firebase/service boundaries, design tokens, error boundary.
Not implemented: login, Firestore access, serial registration/duplicate detection, OCR, camera, Excel import/export, barcode/QR generation, printing.

## Tech stack

React 19 · Vite · TypeScript (strict) · Tailwind CSS v4 · React Router · Firebase (Auth + Firestore) · ESLint + Prettier. OCR provider, XLSX library and barcode/QR/print tooling arrive in later phases.

## Local setup

```
npm install
cp .env.example .env.local   # then fill in Firebase values (optional in Phase 0)
npm run dev       # start dev server
npm run build     # type-check + production build
npm run lint      # ESLint
```

Without Firebase env values the app still runs; Firebase is simply disabled.

## Environment variables

| Variable | Description |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Project id |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Messaging sender id |
| `VITE_FIREBASE_APP_ID` | Web app id |

- **Local development:** put values in `.env.local` (git-ignored). Never commit `.env*` files except `.env.example`.
- **Production:** set the same variables in the hosting/CI environment at build time (Vite inlines them into the bundle).
- Firebase web config identifies the project and is not a secret; access control comes from Firebase Auth and Firestore Security Rules (Phase 2). Never put admin/service-account credentials or third-party OCR secrets in `VITE_*` variables.

## Folder structure

```
src/
├── app/            App, router, providers (error boundary)
├── components/     ui/ (primitives) · common/ (shared pieces)
├── features/       operator · serial · ocr · companies · admin · auth · printing
├── layouts/        OperatorLayout · AdminLayout · AuthLayout
├── pages/          operator/ · admin/ (lazy-loaded) · auth/
├── services/       firebase · serial · ocr · excel · printing  (no React here)
├── hooks/  types/  utils/  config/  styles/
└── main.tsx
```

## Routes (all placeholders)

Auth: `/login` · Operator: `/`, `/scan`, `/history` · Admin: `/admin`, `/admin/import`, `/admin/export`, `/admin/companies`, `/admin/users`, `/admin/history`.

Guards (`RequireAuth`, `RequireOperator`, `RequireAdmin`) live in `src/features/auth` and currently **bypass all checks** (`PHASE0_BYPASS_GUARDS`). Phase 2 connects them to Firebase Auth. Frontend guards are UX only — real authorization is Firestore Security Rules.

## Architecture

- Components render UI only. Firestore transactions, OCR providers, Excel parsing and printing belong in `services/` (behind interfaces) and are consumed via hooks.
- `services/ocr` defines an `OCRService` adapter so the provider can be swapped.
- Serial lookup will be a direct document read by normalized serial (no collection downloads); registration will be a single Firestore transaction.
- Design tokens (`src/styles/index.css`): **blue = action, green = success/print, red = duplicate/stop**, gray = information; 44px minimum touch targets, visible focus rings.
- Mock data in `features/companies/mockCompanies.ts` is development-only.
- No Firestore rules are shipped yet; permissive rules (`allow read, write: if true`) must never be used.

## Future phases

1. **Phase 1** — Operator UI (responsive, keyboard-first scan screen)
2. **Phase 2** — Firebase Auth, roles, Firestore Security Rules
3. **Phase 3** — Serial validation, company configuration
4. **Phase 4** — Shared registration with atomic duplicate detection
5. **Phase 5** — OCR photo capture
6. **Phase 6** — Excel import/export/reconciliation
7. **Phase 7** — Barcode/QR generation and printing
8. **Phase 8** — Admin workflows, history, hardening
