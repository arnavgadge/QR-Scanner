"""Builds the Kaggle upload: ml/kaggle/upload/dotpeen-synth.zip

Contents (synthetic data and code ONLY; the real test photos are never included):
  synth/train/NNNNN.jpg, synth/val/NNNNN.jpg, synth/train_list.txt, synth/val_list.txt,
  synth/dict.txt, synth/stats.json
  code/train_rec.py, code/finetune_rec.yml

Run:  .venv/bin/python kaggle/package.py
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
SYNTH = ML / "data" / "synth"
OUT = ML / "kaggle" / "upload" / "dotpeen-synth.zip"

DATA_FILES = {"train_list.txt", "val_list.txt", "dict.txt", "stats.json"}
IMAGE = re.compile(r"^(train|val)/\d{5}\.jpg$")
CODE = [ML / "train" / "train_rec.py", ML / "train" / "finetune_rec.yml"]


def main() -> None:
    # Never anything from local/ (client photos, labels, downloads) or the real validation set.
    for src in [SYNTH, *CODE]:
        rel = src.resolve().relative_to(ML.parent.resolve()).as_posix()
        assert not rel.startswith(("local/", "ml/data/realval", "ml/test")), rel
    OUT.parent.mkdir(parents=True, exist_ok=True)
    files: list[tuple[Path, str]] = []
    for path in sorted(SYNTH.rglob("*")):
        if path.is_dir():
            continue
        rel = path.relative_to(SYNTH).as_posix()
        if rel == "meta.csv":
            continue  # not needed for training
        # Only generated images and the dataset files: anything else is refused.
        if not (IMAGE.match(rel) or rel in DATA_FILES):
            raise SystemExit(f"refusing to package unexpected file: {path}")
        files.append((path, f"synth/{rel}"))
    files += [(p, f"code/{p.name}") for p in CODE]

    # Every listed image exists and every image is listed.
    listed = set()
    for name in ("train_list.txt", "val_list.txt"):
        for line in (SYNTH / name).read_text().splitlines():
            listed.add(line.split("\t")[0])
    images = {a[len("synth/") :] for _, a in files if a.endswith(".jpg")}
    assert listed == images, "label lists and images do not match"

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_STORED) as z:  # JPEGs are already compressed
        for src, arc in files:
            z.write(src, arc)
    print(f"{OUT}  {OUT.stat().st_size / 1e6:.0f} MB, {len(images)} images, {len(files)} files")


if __name__ == "__main__":
    main()
