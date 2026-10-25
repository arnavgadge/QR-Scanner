"""Stage 4, step 2: the single evaluation on the real test crops (protocol.md).

  python scripts/stage4_eval.py --selftest   # checks the rules on made-up strings only
  python scripts/stage4_eval.py              # THE run (once): writes ml/out/stage4/results.*
"""
from __future__ import annotations

import csv
import json
import re
import sys
import time
from pathlib import Path

import cv2

ML = Path(__file__).resolve().parent.parent
OUT = ML / "out" / "stage4"
CROPS = OUT / "crops"
LABELS = ML.parent / "local" / "client-data" / "labels.csv"
RUN = ML / "checkpoints" / "run1"

# ---- protocol: normalisation and pattern correction ----
L2D = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "A": "4", "S": "5", "G": "6", "T": "7", "B": "8"}
D2L = {"0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "7": "T", "8": "B"}
SERIAL = "DDWLLDDDDDLDD"


def normalise(s: str) -> str:
    s = s.upper()
    for z in "ØøΘθ":
        s = s.replace(z.upper(), "0").replace(z, "0")
    return re.sub(r"[^A-Z0-9]", "", s)


def correct_serial(s: str) -> str:
    if len(s) != 13:
        return s
    out = []
    for ch, cls in zip(s, SERIAL):
        if cls == "W":
            out.append("W")
        elif cls == "D":
            out.append(L2D.get(ch, ch) if ch.isalpha() else ch)
        else:
            out.append(D2L.get(ch, ch) if ch.isdigit() else ch)
    return "".join(out)


def correct_line2(s: str) -> str:
    return "".join(L2D.get(ch, ch) if ch.isalpha() else ch for ch in s)


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def selftest() -> None:
    assert normalise("12wa-q 8Ø5") == "12WAQ805"
    assert normalise("θ1 Ø") == "010"
    assert correct_serial("I7VVKT31846M29") == "I7VVKT31846M29"  # 14 chars: unchanged
    assert correct_serial("3OXKT31846M29") == "30WKT31846M29"
    assert correct_serial("47W4R3O612H2G") == "47WAR30612H26"
    assert correct_serial("47W9R30612H26") == "47W9R30612H26"  # 9 has no letter look-alike
    assert correct_serial("47WAR30612826") == "47WAR30612B26"
    assert correct_line2("1O2614E1") == "102614E1"  # E has no digit look-alike: unchanged
    assert correct_line2("5O73I86I") == "50731861"
    assert correct_line2("3940271OO58l".upper()) == "394027100581"
    assert levenshtein("50731861", "5073186") == 1 and levenshtein("", "ABC") == 3
    print("selftest ok")


# ---- the run ----
def main() -> None:
    sys.path.insert(0, str(ML))
    from paddleocr import TextRecognition

    from train.finetuned import FineTuned

    crops = json.loads((OUT / "crops.json").read_text())
    with open(LABELS, newline="") as f:
        labels = {r["file"].strip(): r for r in csv.DictReader(f)}

    def label_for(photo: str):
        if photo in labels:
            return labels[photo]
        stem = Path(photo).stem
        hits = [r for k, r in labels.items() if Path(k).stem == stem]
        return hits[0] if len(hits) == 1 else None

    base = TextRecognition(model_name="en_PP-OCRv5_mobile_rec")
    tuned = FineTuned(ML / "third_party" / "PaddleOCR", RUN / "best.pdparams", ML / "data" / "synth" / "dict.txt", RUN / "config_used.yml")
    # Cropping failures judged before this run (crops.md), kept with the ignored test outputs.
    failures = {(f, n) for f, n in json.loads((OUT / "crop_failures.json").read_text())}
    rows = []
    for e in crops:
        lab = label_for(e["photo"])
        assert lab is not None, f"no label for {e['photo']}"
        marked = "CHECK" in (lab.get("notes") or "").upper()
        for ln in e["lines"]:
            truth = normalise(lab["serial"] if ln["line"] == 1 else lab["second_line"])
            if ln["file"]:
                img = cv2.imread(str(CROPS / ln["file"]))
                raw_b = base.predict(img)[0]["rec_text"]
                raw_t = tuned.predict_bytes([(CROPS / ln["file"]).read_bytes()])[0][0]
            else:
                raw_b = raw_t = ""
            fix = correct_serial if ln["line"] == 1 else correct_line2
            b, t = normalise(raw_b), normalise(raw_t)
            rows.append(
                {
                    "photo": e["photo"],
                    "line": ln["line"],
                    "type": "serial" if ln["line"] == 1 else "second_line",
                    "marked_check": marked,
                    "crop_ok": (e["photo"], ln["line"]) not in failures,
                    "truth": truth,
                    "baseline_raw": raw_b,
                    "baseline": b,
                    "baseline+pattern": fix(b),
                    "finetuned_raw": raw_t,
                    "finetuned": t,
                    "finetuned+pattern": fix(t),
                }
            )
    variants = ["baseline", "baseline+pattern", "finetuned", "finetuned+pattern"]

    def score(sel: list[dict]) -> dict:
        out = {}
        for v in variants:
            res = {}
            for typ in ("serial", "second_line", "all"):
                s = [r for r in sel if typ == "all" or r["type"] == typ]
                if not s:
                    continue
                em = sum(r[v] == r["truth"] for r in s)
                cer = sum(levenshtein(r[v], r["truth"]) for r in s) / sum(len(r["truth"]) for r in s)
                res[typ] = {"exact": f"{em}/{len(s)}", "exact_rate": round(em / len(s), 3), "cer": round(cer, 3)}
            out[v] = res
        return out

    subsets = {
        "all 8 photos, all lines": rows,
        "all 8 photos, OK crops only": [r for r in rows if r["crop_ok"]],
        "6 unmarked photos, all lines": [r for r in rows if not r["marked_check"]],
        "6 unmarked photos, OK crops only": [r for r in rows if not r["marked_check"] and r["crop_ok"]],
    }
    results = {"run_at": time.strftime("%Y-%m-%d %H:%M:%S"), "lines": rows, "scores": {k: score(v) for k, v in subsets.items()}}
    (OUT / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    for r in rows:
        print(
            f"{r['photo'][23:]:>24} L{r['line']} {'CHECK' if r['marked_check'] else '     '} {'crop-ok ' if r['crop_ok'] else 'CROP-FAIL'}"
            f" | truth {r['truth']:<13} | base {r['baseline']:<15} {'Y' if r['baseline'] == r['truth'] else 'n'}"
            f" | base+p {r['baseline+pattern']:<15} {'Y' if r['baseline+pattern'] == r['truth'] else 'n'}"
            f" | tuned {r['finetuned']:<15} {'Y' if r['finetuned'] == r['truth'] else 'n'}"
            f" | tuned+p {r['finetuned+pattern']:<15} {'Y' if r['finetuned+pattern'] == r['truth'] else 'n'}"
        )
    print(json.dumps(results["scores"], indent=1))


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        if (OUT / "results.json").exists():
            sys.exit("results.json exists: the test has already been run once (protocol: run once)")
        main()
