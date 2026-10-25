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

## Next steps (to do)

### 1. GitHub
- [ ] Make `arnavgadge/QR-Scanner` **private** (owner: Settings → General → Danger zone → Change
      visibility). Do this before pushing: the repository holds the project report and the desktop
      and ML code.
- [ ] Owner adds the second developer as a collaborator (Settings → Collaborators → Add people);
      accept the invitation.
- [ ] Push with a **classic** personal access token (scope `repo`). A fine-grained token cannot
      reach another person's personal repository. Then run `git push origin main`.

### 2. ML round 2: choose the checkpoint (result zip from the second Kaggle run)
- [ ] Copy the round 2 `result.zip` into `local/kaggle/` as `result-run2.zip` (`local/` is never
      committed). Rename the round 1 file there to `result-run1.zip`, so the two can't be mixed up.
- [ ] Unpack it into the ML folder:
      ```bash
      cd ml
      mkdir -p checkpoints/run2 && unzip ../local/kaggle/result-run2.zip -d checkpoints/run2
      ls checkpoints/run2/epochs        # epoch_01.pdparams, epoch_02.pdparams, …
      ```
- [ ] Score every epoch on the 8 real photos, on this computer only:
      ```bash
      .venv/bin/python scripts/crop_lines.py      # only if ml/data/realval/ is missing
      .venv/bin/python scripts/select_checkpoint.py --run checkpoints/run2
      ```
      It prints one row per epoch: synthetic validation loss, real CER, real exact match. It marks
      the tied epochs (within 1 character error of the best) and the chosen one, and writes
      `checkpoints/run2/chosen.pdparams` and `chosen.json`.
- [ ] Check the curves (`checkpoints/run2/curves.png`) and `history.csv`: did the accuracy dips of
      round 1 go away with the lower learning rate? Did early stopping trigger?
- [ ] Compare with round 1. Round 1's model read 11 of 16 real lines with the new crops. This is
      only a hint, because the cropper was tuned on these same photos.

### 3. ML round 2: test (once the USB-camera photos arrive)
- [ ] Collect the new **USB-camera photos** with their answers (ideally 50–100). Put them in
      `local/client-data/` (photos zip and a labels file with the same columns as `labels.csv`).
      These are the round 2 **test set**: not used for anything before the final evaluation.
- [ ] Write and freeze a test protocol (`ml/out/round2/protocol.md`) before unpacking them, as in
      round 1: cropping method, pattern correction, measures, run once.
- [ ] **Scripts to update first** (they still point at round 1):
  - `ml/scripts/export_onnx.py` reads `checkpoints/run1/best.pdparams`. Make it take the run
    folder and `chosen.pdparams`.
  - `ml/scripts/stage4_eval.py` reads `checkpoints/run1/best.pdparams` and the round 1 photos. Copy
    it to a round 2 script that reads the new photos and `checkpoints/run2/chosen.pdparams`, and
    uses `ml/scripts/crop_lines.py` for cropping.
- [ ] Run the test **once**. Report per line and overall: exact match and character error rate,
      baseline vs fine-tuned, with and without pattern correction.
- [ ] Export the chosen model to ONNX; record its size and CPU time per line.

### 4. Desktop app: camera reading (after the round 2 test)
- [ ] Add USB-camera capture to the desktop scan screen. Reading uses the ONNX model and the
      `crop_lines.py` method, rebuilt for the app. Pattern correction is used for the serial.
- [ ] Bundle the ONNX model and `dict.txt` with the app. No internet is needed: the model and the
      runtime are packaged.

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
