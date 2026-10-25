#!/usr/bin/env bash
# Refuses a commit that would add forbidden files. Run before committing (or use as a pre-commit
# hook: ln -s ../../scripts/check-staged.sh .git/hooks/pre-commit).
#
# Forbidden: client data (photos, labels, exports), datasets, model weights, checkpoints, ONNX
# files, zips, build output, local files (.env, local.properties, .venv, node_modules), secrets
# (keys, certificates, service-account files), and any file over 10 MB.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
MAX=$((10 * 1024 * 1024))
bad=0

forbidden='(^|/)(local|node_modules|\.venv|build|dist)/|^ml/(data|out|checkpoints|models|test|third_party|kaggle/upload)/'
forbidden+='|(^|/)\.env($|\.)|(^|/)local\.properties$|(^|/)\.DS_Store$'
forbidden+='|\.(zip|pdparams|pdopt|pdstates|pdiparams|onnx|exe|blockmap|apk|aab|dmg|numbers|pem|key|p12|jks|keystore)$'
forbidden+='|(^|/)(Engravings[^/]*|labels\.csv|google-services\.json|GoogleService-Info\.plist|serviceAccount[^/]*\.json)$'

while IFS= read -r -d '' f; do
  [[ -e "$f" ]] || continue # deletions are fine
  if [[ "$f" =~ $forbidden && "$f" != ".env.example" && "$f" != */.env.example ]]; then
    echo "FORBIDDEN: $f"
    bad=1
  fi
  if [[ "$f" == *.xlsx && "$f" != apps/web/sample-data/* && "$f" != apps/web/tests/fixtures/* ]]; then
    echo "FORBIDDEN spreadsheet (only generated samples/fixtures may be committed): $f"
    bad=1
  fi
  size=$(wc -c <"$f")
  if ((size > MAX)); then
    echo "TOO LARGE ($((size / 1024 / 1024)) MB): $f"
    bad=1
  fi
done < <(git diff --cached --name-only -z --diff-filter=ACMR)

# Keys or tokens inside staged text.
if git diff --cached -U0 | grep -nE '^\+.*(AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[0-9A-Za-z]{30,}|sk-[A-Za-z0-9]{20,})'; then
  echo "FORBIDDEN: something that looks like a key or token is staged (lines above)"
  bad=1
fi

if ((bad)); then
  echo "check-staged: refused"
  exit 1
fi
echo "check-staged: ok ($(git diff --cached --name-only | wc -l | tr -d ' ') staged files)"
