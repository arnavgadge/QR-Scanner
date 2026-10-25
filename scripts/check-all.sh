#!/usr/bin/env bash
# Runs every check of the project, from the right folders. Stops at the first failure.
#
#   scripts/check-all.sh            everything
#   scripts/check-all.sh --quick    skips the Windows installer and the ML training epoch
#
# Needs: Node (apps installed with npm install), Java 21 (Firebase emulator and Android; Homebrew
# openjdk@21 is used if present), the Android SDK (apps/android-scanner/local.properties), and the
# ML environment (ml/.venv, see ml/README.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUICK=0
[[ "${1:-}" == "--quick" ]] && QUICK=1
if [[ -d /opt/homebrew/opt/openjdk@21 ]]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21
  export PATH="$JAVA_HOME/bin:$PATH"
fi
step() { printf '\n==== %s ====\n' "$*"; }

step "web: type-check, lint, format"
cd "$ROOT/apps/web"
npx tsc -b
npx eslint .
npx prettier --check src tests scripts firestore-tests

step "web: tests (Firestore emulator) and security-rules tests"
npm test
npm run test:rules

step "web: production build and bundle check"
npm run build
npm run verify:bundle

step "desktop: type-check, lint, format"
cd "$ROOT/apps/desktop"
npm run typecheck
npm run lint
npm run format:check

step "desktop: tests under plain Node and under Electron"
npm test -- --node
npm test

step "desktop: build and bundle check"
npm run build
npm run verify:bundle
if [[ $QUICK == 0 ]]; then
  step "desktop: Windows installer"
  npx electron-builder --win nsis --x64
fi

step "android: unit tests and debug build (offline guard included)"
cd "$ROOT/apps/android-scanner"
./gradlew --quiet testDebugUnitTest assembleDebug

step "ml: smoke test"
cd "$ROOT/ml"
.venv/bin/python scripts/stage4_eval.py --selftest
.venv/bin/python - <<'PY'
# Dataset generator: 40 saved images must regenerate byte for byte.
import csv, hashlib, random, sys
import cv2
sys.path.insert(0, ".")
from synth.augment import make_sample
rows = list(csv.DictReader(open("data/synth/meta.csv")))
same = 0
for r in random.Random(7).sample(rows, 40):
    img, _ = make_sample(r["label"], int(r["seed"]))
    enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()
    same += hashlib.md5(enc).digest() == hashlib.md5(open("data/synth/" + r["file"], "rb").read()).digest()
assert same == 40, f"only {same}/40 images reproduced"
print("generator: 40/40 images reproduced")
PY
if [[ $QUICK == 0 ]]; then
  rm -rf out/smoke_check
  .venv/bin/python train/train_rec.py --paddleocr third_party/PaddleOCR --data data/synth \
    --out out/smoke_check --smoke --epochs 1 --cpu --workers 0
  .venv/bin/python scripts/select_checkpoint.py --run out/smoke_check
fi

step "all checks passed"
