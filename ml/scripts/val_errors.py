"""Stage 3 check (synthetic validation set only): where does the chosen checkpoint go wrong?
Accuracy by line type and by what was applied to the image, the most common character
confusions, and a sheet of wrongly read validation lines."""
import csv
import json
import sys
import time
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))
from train.finetuned import FineTuned  # noqa: E402

DATA = ML / "data" / "synth"
RUN = ML / "checkpoints" / "run1"
OUT = ML / "out" / "stage3"

meta = {r["file"]: r for r in csv.DictReader(open(DATA / "meta.csv")) if r["split"] == "val"}
items = [l.split("\t") for l in (DATA / "val_list.txt").read_text().splitlines()]
model = FineTuned(ML / "third_party" / "PaddleOCR", RUN / "best.pdparams", DATA / "dict.txt", RUN / "config_used.yml")
t0 = time.perf_counter()
preds = model.predict_bytes([(DATA / f).read_bytes() for f, _ in items])
per_line_ms = (time.perf_counter() - t0) / len(items) * 1000

rows = []
for (f, label), (text, conf) in zip(items, preds):
    m = meta[f]
    rows.append({"file": f, "label": label, "pred": text, "conf": conf, "ok": text == label, **m})


def acc(sel):
    sel = list(sel)
    return f"{sum(r['ok'] for r in sel) / max(1, len(sel)):.3f} ({len(sel)})"


report = {"overall": acc(rows), "ms_per_line_cpu_batch64": round(per_line_ms, 1)}
report["by_kind"] = {k: acc(r for r in rows if r["kind"] == k) for k in ("serial", "num8", "num12")}
report["by_heavy_count"] = {
    n: acc(r for r in rows if len([e for e in r["heavy"].split(",") if e]) == n) for n in range(4)
}
report["with_effect"] = {
    e: acc(r for r in rows if e in r["heavy"].split(","))
    for e in ("rust", "glare", "blur", "low_res", "strong_jpeg")
}
report["by_plate"] = {p: acc(r for r in rows if r["plate"] == p) for p in ("paint", "metal")}
report["wrong_length"] = sum(len(r["pred"]) != len(r["label"]) for r in rows if not r["ok"])
conf = Counter()
for r in rows:
    if not r["ok"] and len(r["pred"]) == len(r["label"]):
        for a, b in zip(r["label"], r["pred"]):
            if a != b:
                conf[f"{a}->{b}"] += 1
report["top_confusions_same_length"] = conf.most_common(15)
serial_pos = Counter()
for r in rows:
    if r["kind"] == "serial" and not r["ok"] and len(r["pred"]) == 13:
        for i, (a, b) in enumerate(zip(r["label"], r["pred"])):
            if a != b:
                serial_pos[i + 1] += 1
report["serial_error_positions"] = dict(sorted(serial_pos.items()))
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "val_errors.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))

wrong = [r for r in rows if not r["ok"]][:40]
tiles = []
for r in wrong:
    img = cv2.imread(str(DATA / r["file"]))[:, :560]
    t = np.full((72, 570, 3), 255, np.uint8)
    t[2 : 2 + img.shape[0], 5 : 5 + img.shape[1]] = img
    cv2.putText(t, f"{r['label']} -> {r['pred']}  [{r['heavy']}]", (6, 66), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 160), 1, cv2.LINE_AA)
    tiles.append(t)
cv2.imwrite(str(OUT / "val_errors.jpg"), np.vstack([np.hstack(tiles[i : i + 2]) for i in range(0, len(tiles) - 1, 2)]))
