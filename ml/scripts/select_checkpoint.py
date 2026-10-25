"""Round 2: choose the checkpoint, on this Mac, with the 8 real photos (they never leave this
computer: not uploaded to Kaggle, never used for training).

After downloading the Kaggle result (unpacked to e.g. ml/checkpoints/run2/ with epochs/ and
history.csv):

  .venv/bin/python scripts/select_checkpoint.py --run checkpoints/run2

For every epoch checkpoint it reads the 16 real validation lines (ml/data/realval, cropped by
scripts/crop_lines.py) and prints one table:
  epoch | synthetic val loss | synthetic exact | real CER | real exact | (with pattern correction)

Choice (of the model's own reading, without pattern correction):
  1. Best = the fewest character errors on the 16 real lines (lowest real CER).
  2. Tied = every epoch with at most ONE character error more than the best (16 lines are too few
     to tell such epochs apart).
  3. Among the tied epochs, the LOWEST SYNTHETIC VALIDATION LOSS wins (then fewer real errors,
     then the earlier epoch).
The table marks the tied set. The chosen weights are copied to <run>/chosen.pdparams and the
reasoning to <run>/chosen.json.
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from stage4_eval import correct_line2, correct_serial, levenshtein, normalise  # noqa: E402
from train.finetuned import FineTuned  # noqa: E402

REALVAL = ML / "data" / "realval"
TIE_ERRORS = 1  # epochs within this many character errors of the best count as tied


def score(preds: list[str], truths: list[str]) -> tuple[float, int, int]:
    """(CER, exact lines, total character errors)."""
    errors = sum(levenshtein(p, t) for p, t in zip(preds, truths))
    exact = sum(p == t for p, t in zip(preds, truths))
    return errors / sum(len(t) for t in truths), exact, errors


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True, help="unpacked Kaggle result (epochs/, history.csv)")
    args = ap.parse_args()
    run = (ML / args.run) if not Path(args.run).is_absolute() else Path(args.run)

    history = {int(r["epoch"]): r for r in csv.DictReader(open(run / "history.csv"))}
    ckpts = sorted((run / "epochs").glob("epoch_*.pdparams"))
    assert ckpts, f"no checkpoints in {run / 'epochs'}"
    items = [l.split("\t") for l in (REALVAL / "realval_list.txt").read_text().splitlines() if l]
    images = [(REALVAL / f).read_bytes() for f, _ in items]
    truths = [normalise(t) for _, t in items]
    fixes = [correct_serial if f.endswith("line1.png") else correct_line2 for f, _ in items]

    model = FineTuned(ML / "third_party" / "PaddleOCR", ckpts[0], ML / "data" / "synth" / "dict.txt", run / "config_used.yml")
    table = []
    for ck in ckpts:
        epoch = int(ck.stem.split("_")[1])
        model.load(ck)
        preds = [normalise(t) for t, _ in model.predict_bytes(images)]
        cer, exact, errors = score(preds, truths)
        cer_p, exact_p, _ = score([fx(p) for fx, p in zip(fixes, preds)], truths)
        h = history.get(epoch, {})
        table.append(
            {
                "epoch": epoch,
                "synth_val_loss": float(h.get("val_loss", "nan")),
                "synth_val_exact": float(h.get("val_exact_match", "nan")),
                "real_cer": round(cer, 4),
                "real_errors": errors,
                "real_exact": exact,
                "real_cer_pattern": round(cer_p, 4),
                "real_exact_pattern": exact_p,
                "predictions": preds,
            }
        )

    n = len(truths)
    fewest = min(r["real_errors"] for r in table)
    tied = [r for r in table if r["real_errors"] <= fewest + TIE_ERRORS]
    best = min(tied, key=lambda r: (r["synth_val_loss"], r["real_errors"], r["epoch"]))
    for r in table:
        r["tied"] = r in tied
    print(
        f"\n{'epoch':>5} | {'synth val loss':>14} | {'synth exact':>11} | {'real CER':>8} | {'errors':>6} |"
        f" {'real exact':>10} | {'+pattern CER':>12} | {'+pattern exact':>14} | tied"
    )
    print("-" * 113)
    for r in table:
        mark = "CHOSEN" if r is best else ("tied" if r["tied"] else "")
        print(
            f"{r['epoch']:>5} | {r['synth_val_loss']:>14.4f} | {r['synth_val_exact']:>11.3f} | {r['real_cer']:>8.3f} |"
            f" {r['real_errors']:>6} | {r['real_exact']:>4}/{n:<5} | {r['real_cer_pattern']:>12.3f} |"
            f" {r['real_exact_pattern']:>7}/{n:<6} | {mark}"
        )
    print(
        f"\nTied set (at most {fewest + TIE_ERRORS} character errors = best {fewest} + {TIE_ERRORS}): "
        + ", ".join(
            f"epoch {r['epoch']} ({r['real_errors']} errors, synth loss {r['synth_val_loss']:.4f})" for r in tied
        )
    )
    why = (
        f"Epoch {best['epoch']}: the fewest real character errors was {fewest}; epochs with at most "
        f"{fewest + TIE_ERRORS} count as tied ({len(tied)} epoch(s)). Among them, epoch {best['epoch']} "
        f"has the lowest synthetic validation loss ({best['synth_val_loss']:.4f}); on the real lines it "
        f"makes {best['real_errors']} character errors (CER {best['real_cer']:.3f}, "
        f"{best['real_exact']}/{n} lines exact)."
    )
    print("\nChosen:", why)
    print(
        "Caution: 16 real lines, 2 photos marked CHECK. Choosing on them makes their score "
        "optimistic for this checkpoint; the round 2 test photos give the honest number."
    )
    shutil.copy(run / "epochs" / f"epoch_{best['epoch']:02d}.pdparams", run / "chosen.pdparams")
    (run / "chosen.json").write_text(
        json.dumps(
            {
                "chosen_epoch": best["epoch"],
                "rule": f"tied = within {TIE_ERRORS} character error of the fewest; lowest synthetic val loss among tied",
                "tied_epochs": [r["epoch"] for r in tied],
                "why": why,
                "table": table,
                "truths": truths,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
