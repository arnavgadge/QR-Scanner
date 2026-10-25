# VICIMUS Serial Scanning & Label System

Registers every engraved serial number once per company, warns at once when a serial has
already been used (a duplicate), and prints the product label (barcode or QR code). Serials are
dot-peen engraved on metal plates and are read by typing, a hand scanner, or a camera with OCR.

The main product is the **desktop app**: one office computer is the *main computer* (it keeps the
database) and any number of *stations* scan and print on the office network. It needs no
internet and no cloud account. The original **web app** runs on Firebase; its React code also
draws the desktop app's screens.

## Folder map

```
QR-Scanner/
├── README.md               this file
├── .gitignore
├── apps/
│   ├── web/                React app: web build (Firebase) and the desktop app's screens
│   │   ├── src/              app code (pages, features, services, i18n, desktop screens)
│   │   ├── public/           static files (OCR data is copied in on install)
│   │   ├── tests/            unit and integration tests (Firestore emulator)
│   │   ├── firestore-tests/  security-rules tests
│   │   ├── scripts/          web-only scripts (seed data, indexes, sample sheets, bundle check)
│   │   ├── sample-data/      generated sample Excel files
│   │   ├── firestore.rules, firestore.indexes.json, firebase.json
│   │   ├── vite.config.ts, vitest.config.ts, tsconfig*.json, eslint.config.js, .prettierrc.json
│   │   ├── package.json, .env.example (copy to .env.local)
│   │   └── README.md
│   ├── desktop/            Electron app (main computer, stations, backup)
│   │   ├── src/              main process, server, station link, preload
│   │   ├── tests/            server, pairing, backup and promotion tests
│   │   ├── scripts/          build, start, test runner, bundle check
│   │   ├── build-resources/  Windows installer settings
│   │   ├── package.json, eslint.config.mjs, .prettierrc.json
│   │   └── README.md
│   └── android-scanner/    phone scanner (shelved)
│       ├── app/              Kotlin app and unit tests
│       └── build.gradle.kts, settings.gradle.kts, gradlew
├── ml/                     OCR training pipeline
│   ├── synth/                synthetic engraving generator
│   ├── scripts/              dataset, cropping, evaluation, checkpoint choice, ONNX export
│   ├── train/                fine-tuning script and config
│   ├── kaggle/               Kaggle notebook and upload packaging
│   ├── README.md, requirements.lock.txt
│   └── (git-ignored: .venv, data, out, checkpoints, models, third_party, test)
├── docs/                   project documents and the project report
├── scripts/                shared scripts
│   ├── check-all.sh          runs every check
│   └── check-staged.sh       refuses commits with forbidden files
└── local/                  git-ignored, never committed
    ├── client-data/          Engravings.zip, labels.csv
    ├── exports/              serial-label exports
    └── kaggle/               downloaded results (result.zip)
```

| Folder | What it is | Details |
| --- | --- | --- |
| `apps/web/` | React app (TypeScript, Vite). Built normally it is the web app on Firebase; built in "desktop" mode it is the desktop app's screens. Firebase rules and their tests live here too. | [apps/web/README.md](apps/web/README.md) |
| `apps/desktop/` | Electron desktop app: main computer (SQLite database, HTTPS server, pairing, backup and promotion) and stations; Windows installer. | [apps/desktop/README.md](apps/desktop/README.md) |
| `apps/android-scanner/` | Android phone scanner (Kotlin, works as a Bluetooth keyboard). Shelved. | — |
| `ml/` | OCR for dot-peen serials: synthetic training data, PaddleOCR fine-tuning (Kaggle GPU), evaluation, ONNX export. | [ml/README.md](ml/README.md) |
| `docs/` | Project documents: production readiness, print calibration, OCR test protocol, test matrices, project report. | |
| `scripts/` | Shared scripts: `check-all.sh` runs every check; `check-staged.sh` refuses commits that contain forbidden files. | |
| `local/` | **Never committed** (git-ignored): `client-data/` (client photos and answers), `exports/`, `kaggle/` (downloaded results). | |

## Running each part

**Requirements:**

| Part | Needs |
| --- | --- |
| Web and desktop | Node.js 24 and npm |
| Firebase emulator, Android | Java 21 (e.g. Homebrew `openjdk@21`) |
| Android | the Android SDK |
| ML | Python 3.12 with `uv` |

**Web app**

```bash
cd apps/web
npm install
npm run dev            # http://localhost:5173 (copy .env.example to .env.local first)
npm test               # unit and integration tests against the Firestore emulator
npm run test:rules     # Firestore security-rules tests
npm run build
```

**Desktop app.** Install `apps/web` first; the desktop build uses it.

```bash
cd apps/desktop
npm install
npm start              # builds and opens the app (first run: choose main computer or station)
npm test               # tests inside Electron's runtime (npm test -- --node: plain Node)
npm run dist:win       # Windows installer in apps/desktop/dist/
```

**Android scanner (shelved)**

```bash
cd apps/android-scanner
./gradlew testDebugUnitTest assembleDebug
```

**ML.** See [ml/README.md](ml/README.md): the Python environment, building the synthetic
dataset, training on Kaggle, and choosing the checkpoint on this computer with the real photos.

**Every check at once**

```bash
scripts/check-all.sh           # or --quick: skips the Windows installer and the ML training epoch
```

## What never goes into git

- **Client data:** client photos and answers, and anything derived from them: crops, test
  results.
- **Data and models:** datasets, model weights, checkpoints, ONNX files, Kaggle zips.
- **Local and build files:** `.env` files, `local.properties`, `.venv`, `node_modules`, build
  output.
- **Secrets:** keys and certificates.
- **Size:** any file over 10 MB.

`.gitignore` covers all of these. Run `scripts/check-staged.sh` before committing; it refuses the
commit if any of them is staged. To run it automatically on every commit:

```bash
ln -s ../../scripts/check-staged.sh .git/hooks/pre-commit
```
