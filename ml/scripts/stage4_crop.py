"""Stage 4, step 1: crop the two text lines out of each real test photo, exactly as written in
ml/out/stage4/protocol.md. No text recognition is run here.

Output: ml/out/stage4/crops/<photo>_line1.png, _line2.png, crops.json, crops_sheet.jpg
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

ML = Path(__file__).resolve().parent.parent
ZIP = ML.parent / "local" / "client-data" / "Engravings.zip"
TEST = ML / "test" / "engravings"
OUT = ML / "out" / "stage4"
CROPS = OUT / "crops"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp"}


def unpack() -> list[Path]:
    TEST.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ZIP) as z:
        z.extractall(TEST)
    return sorted(
        p for p in TEST.rglob("*") if p.suffix.lower() in IMAGE_EXT and "__MACOSX" not in p.parts
    )


def load(path: Path) -> np.ndarray:
    """Step 1: read, apply EXIF orientation; BGR."""
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def detect(det, img: np.ndarray) -> list[np.ndarray]:
    res = det.predict(img)[0]
    return [np.array(p, np.float32).reshape(-1, 2) for p in res["dt_polys"]]


def wide_ratio(polys: list[np.ndarray]) -> float:
    """Median width/height of the 4 largest boxes (axis-aligned)."""
    if not polys:
        return 0.0
    dims = [(np.ptp(p[:, 0]), np.ptp(p[:, 1])) for p in polys]
    dims = sorted(dims, key=lambda d: d[0] * d[1], reverse=True)[:4]
    return float(np.median([w / max(h, 1e-6) for w, h in dims]))


def rows_from(polys: list[np.ndarray]) -> list[dict]:
    """Step 3: merge boxes on the same text row (vertical overlap > 50% of the smaller height)."""
    boxes = [{"pts": p, "y0": p[:, 1].min(), "y1": p[:, 1].max()} for p in polys]
    boxes.sort(key=lambda b: (b["y0"] + b["y1"]) / 2)
    rows: list[dict] = []
    for b in boxes:
        h = b["y1"] - b["y0"]
        for r in rows:
            overlap = min(r["y1"], b["y1"]) - max(r["y0"], b["y0"])
            if overlap > 0.5 * min(h, r["y1"] - r["y0"]):
                r["pts"] = np.vstack([r["pts"], b["pts"]])
                r["y0"], r["y1"] = min(r["y0"], b["y0"]), max(r["y1"], b["y1"])
                break
        else:
            rows.append(dict(b))
    for r in rows:
        r["height"] = float(r["y1"] - r["y0"])
        r["width"] = float(np.ptp(r["pts"][:, 0]))
        r["cy"] = float((r["y0"] + r["y1"]) / 2)
    if rows:
        med = float(np.median([r["height"] for r in rows]))
        rows = [r for r in rows if 0.6 * med <= r["height"] <= 1.6 * med]
    return rows


def rotate_crop(img: np.ndarray, points: np.ndarray) -> np.ndarray:
    """PaddleOCR tools/infer/utility.py get_rotate_crop_image (v3.7.0), unchanged."""
    w = int(max(np.linalg.norm(points[0] - points[1]), np.linalg.norm(points[2] - points[3])))
    h = int(max(np.linalg.norm(points[0] - points[3]), np.linalg.norm(points[1] - points[2])))
    std = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    M = cv2.getPerspectiveTransform(points.astype(np.float32), std)
    dst = cv2.warpPerspective(img, M, (w, h), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_CUBIC)
    if dst.shape[0] * 1.0 / dst.shape[1] >= 1.5:
        dst = np.rot90(dst)
    return dst


def line_crop(img: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Step 5: minimum-area rectangle, padded 15% of the line height above/below and 5% left/right,
    straightened (corner order as in PaddleOCR's get_minarea_rect_crop)."""
    (cx, cy), (a, b), ang = cv2.minAreaRect(pts.astype(np.float32))
    if a >= b:
        w, h = a + 0.10 * b, b * 1.30
    else:
        w, h = a * 1.30, b + 0.10 * a
    box = cv2.boxPoints(((cx, cy), (w, h), ang))
    hh, ww = img.shape[:2]
    box[:, 0] = np.clip(box[:, 0], 0, ww - 1)
    box[:, 1] = np.clip(box[:, 1], 0, hh - 1)
    p = sorted(list(box), key=lambda x: x[0])
    a_, d_ = (0, 1) if p[1][1] > p[0][1] else (1, 0)
    b_, c_ = (2, 3) if p[3][1] > p[2][1] else (3, 2)
    return rotate_crop(img, np.array([p[a_], p[b_], p[c_], p[d_]], np.float32))


def main() -> None:
    from paddleocr import TextDetection, TextLineOrientationClassification

    photos = unpack()
    det = TextDetection(model_name="PP-OCRv5_server_det")
    ori = TextLineOrientationClassification(model_name="PP-LCNet_x1_0_textline_ori")
    CROPS.mkdir(parents=True, exist_ok=True)
    report = []
    for path in photos:
        img = load(path)
        # Step 2: as-is or turned 90 degrees, whichever has wider-than-tall boxes.
        turned = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        r0, r90 = wide_ratio(detect(det, img)), wide_ratio(detect(det, turned))
        rot = 90 if r90 > r0 else 0
        upright = turned if rot else img
        # Steps 3-4.
        rows = rows_from(detect(det, upright))
        picked = sorted(sorted(rows, key=lambda r: r["width"], reverse=True)[:2], key=lambda r: r["cy"])
        crops = [line_crop(upright, r["pts"]) for r in picked]
        # Step 6 (with amendment 1).
        flips = []
        for c in crops:
            res = ori.predict(np.ascontiguousarray(c))[0]
            flips.append(str(res["label_names"][0]) == "180_degree")
        if len(crops) == 2 and all(flips):
            crops = [np.ascontiguousarray(np.rot90(c, 2)) for c in crops][::-1]
            whole = True
        else:
            crops = [np.ascontiguousarray(np.rot90(c, 2)) if f else c for c, f in zip(crops, flips)]
            whole = False
        entry = {
            "photo": path.name,
            "size": list(img.shape[:2]),
            "turned_90": bool(rot),
            "ratio_0": round(r0, 2),
            "ratio_90": round(r90, 2),
            "rows_found": len(rows),
            "flipped_180": flips,
            "whole_photo_upside_down": whole,
            "lines": [],
        }
        stem = path.stem
        for i in range(2):
            name = f"{stem}_line{i + 1}.png"
            if i < len(crops):
                cv2.imwrite(str(CROPS / name), crops[i])
                entry["lines"].append({"line": i + 1, "file": name, "size": list(crops[i].shape[:2])})
            else:
                entry["lines"].append({"line": i + 1, "file": None, "failure": "line not found"})
        report.append(entry)
        print(json.dumps(entry))
    (OUT / "crops.json").write_text(json.dumps(report, indent=2))

    # Sheet for judging the crops (before any recognition).
    tiles = []
    for e in report:
        for ln in e["lines"]:
            t = np.full((110, 900, 3), 255, np.uint8)
            label = f"{e['photo']}  line {ln['line']}"
            if ln["file"]:
                c = cv2.imread(str(CROPS / ln["file"]))
                s = 80 / c.shape[0]
                c = cv2.resize(c, (min(880, int(c.shape[1] * s)), 80))
                t[2:82, 5 : 5 + c.shape[1]] = c
            else:
                label += "  NOT FOUND"
            cv2.putText(t, label, (6, 102), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)
            tiles.append(t)
    cv2.imwrite(str(OUT / "crops_sheet.jpg"), np.vstack(tiles))


if __name__ == "__main__":
    sys.exit(main())
