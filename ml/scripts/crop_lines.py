"""Round 2 line cropper (improves on stage4_crop.py, which stays as the record of the stage 4 test):

1. EXIF orientation. Detection at the detector's normal size (long side 960 px) first; only if
   that finds fewer than 2 rows or very small text (rows under 40 px) is the photo upscaled
   (short side to 1280 px) and detected at up to 2048 px. Upscaling is a fallback because it
   made the detector miss text on one validation photo.
2. Turn to the nearest 90 degrees: as-is or turned, whichever gives wider-than-tall boxes.
3. Rows: specks dropped, boxes merged by their (slanted) centre line, rows of unusual height
   dropped. Stage 4 compared straight vertical extents, which merged two slanted lines.
4. Orientation by MAJORITY VOTE over all the photo's rows (text-line orientation classifier),
   weighted by confidence (mean probability of "upside down" over the rows): if it is over 0.5,
   the whole photo is turned 180 degrees and detected again. Every
   line of a photo therefore gets the same orientation.
5. The two widest rows, top to bottom = line 1 (serial), line 2. Padded crop as in stage 4.

Builds the round 2 REAL VALIDATION set from the 8 original photos (never used for training):
  ml/data/realval/NN_lineK.png, realval_list.txt ("file<TAB>label"), crops.json, crops_sheet.jpg
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from stage4_crop import line_crop, load, wide_ratio  # noqa: E402  (same geometry)

MIN_SHORT_SIDE = 1280
DET_LIMIT = 2048
SMALL_TEXT_PX = 40


def detect(det, img):
    res = det.predict(img)[0]
    return [np.array(p, np.float32).reshape(-1, 2) for p in res["dt_polys"]]


def rows_from(polys: list[np.ndarray]) -> list[dict]:
    """Rows of text, robust to slanted lines and specks:
    - each box: rotated rectangle (centre, slanted height = short side);
    - specks dropped first (height under 35% of the tallest box);
    - boxes on one row: centres closer vertically than half the smaller height;
    - rows of unusual height (outside 0.6-1.6 x median) dropped."""
    boxes = []
    for p in polys:
        (cx, cy), (a, b), _ = cv2.minAreaRect(p.astype(np.float32))
        boxes.append({"pts": p, "cy": cy, "h": min(a, b)})
    if not boxes:
        return []
    tallest = max(b["h"] for b in boxes)
    boxes = sorted((b for b in boxes if b["h"] >= 0.35 * tallest), key=lambda b: b["cy"])
    rows: list[dict] = []
    for b in boxes:
        for r in rows:
            if abs(r["cy"] - b["cy"]) < 0.5 * min(r["h"], b["h"]):
                r["pts"] = np.vstack([r["pts"], b["pts"]])
                r["hs"].append(b["h"])
                break
        else:
            rows.append({"pts": b["pts"], "cy": b["cy"], "h": b["h"], "hs": [b["h"]]})
    for r in rows:
        r["height"] = float(np.median(r["hs"]))
        r["width"] = float(np.ptp(r["pts"][:, 0]))
        r["cy"] = float(r["pts"][:, 1].mean())
    med = float(np.median([r["height"] for r in rows]))
    return [r for r in rows if 0.6 * med <= r["height"] <= 1.6 * med]


def find_rows(dets, img):
    """Normal detector size first; upscaled only if that finds under 2 rows or tiny text."""
    det, det_big = dets
    rows = rows_from(detect(det, img))
    if len(rows) >= 2 and min(r["height"] for r in rows) >= SMALL_TEXT_PX:
        return rows, img, False
    h, w = img.shape[:2]
    scale = max(1.0, MIN_SHORT_SIDE / min(h, w))
    big = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_CUBIC)
    big_rows = rows_from(detect(det_big, big))
    if len(big_rows) > len(rows) or (len(big_rows) == len(rows) >= 2):
        return big_rows, big, True
    return rows, img, False


def crop_photo(dets, ori, img: np.ndarray) -> tuple[list[np.ndarray], dict]:
    det = dets[0]
    turned = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    r0, r90 = wide_ratio(detect(det, img)), wide_ratio(detect(det, turned))
    upright = turned if r90 > r0 else img
    rows, used, upscaled = find_rows(dets, upright)
    votes, p180 = [], []
    for r in rows:
        c = np.ascontiguousarray(line_crop(used, r["pts"]))
        res = ori.predict(c)[0]
        is180 = str(res["label_names"][0]) == "180_degree"
        score = float(res["scores"][0])
        votes.append(is180)
        p180.append(score if is180 else 1 - score)
    # Majority vote weighted by confidence (a 1-1 split is decided by the surer line).
    flipped = bool(p180) and float(np.mean(p180)) > 0.5
    if flipped:
        upright = cv2.rotate(upright, cv2.ROTATE_180)
        rows, used, upscaled = find_rows(dets, upright)
    picked = sorted(sorted(rows, key=lambda r: r["width"], reverse=True)[:2], key=lambda r: r["cy"])
    crops = [np.ascontiguousarray(line_crop(used, r["pts"])) for r in picked]
    info = {
        "turned_90": r90 > r0,
        "upscaled": upscaled,
        "rows": len(rows),
        "votes_180": f"{sum(votes)}/{len(votes)}",
        "mean_p180": round(float(np.mean(p180)), 3) if p180 else None,
        "turned_180": flipped,
    }
    return crops, info


def main() -> None:
    from paddleocr import TextDetection, TextLineOrientationClassification

    dets = (
        TextDetection(model_name="PP-OCRv5_server_det"),
        TextDetection(model_name="PP-OCRv5_server_det", limit_side_len=DET_LIMIT, limit_type="max"),
    )
    ori = TextLineOrientationClassification(model_name="PP-LCNet_x1_0_textline_ori")
    photos = sorted((ML / "test" / "engravings").glob("*.jpeg"))
    labels = {r["file"].strip(): r for r in csv.DictReader(open(ML.parent / "local" / "client-data" / "labels.csv", newline=""))}
    out = ML / "data" / "realval"
    out.mkdir(parents=True, exist_ok=True)
    report, lines, tiles = [], [], []
    for n, p in enumerate(photos, 1):
        lab = labels.get(p.name) or next(v for k, v in labels.items() if Path(k).stem == p.stem)
        crops, info = crop_photo(dets, ori, load(p))
        info.update({"photo": p.name, "id": f"{n:02d}", "check": "CHECK" in (lab.get("notes") or "").upper(), "lines_found": len(crops)})
        report.append(info)
        print(json.dumps(info))
        for k, (c, truth) in enumerate(zip(crops, (lab["serial"], lab["second_line"])), 1):
            name = f"{n:02d}_line{k}.png"
            cv2.imwrite(str(out / name), c)
            lines.append(f"{name}\t{truth.strip().upper()}")
            s = 70 / c.shape[0]
            r = cv2.resize(c, (min(860, int(c.shape[1] * s)), 70))
            t = np.full((96, 880, 3), 255, np.uint8)
            t[2:72, 5 : 5 + r.shape[1]] = r
            cv2.putText(t, f"{name}  {p.name[24:]}  label {truth}", (6, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)
            tiles.append(t)
    (out / "realval_list.txt").write_text("\n".join(lines) + "\n")
    (out / "crops.json").write_text(json.dumps(report, indent=2))
    cv2.imwrite(str(out / "crops_sheet.jpg"), np.vstack(tiles))


if __name__ == "__main__":
    main()
