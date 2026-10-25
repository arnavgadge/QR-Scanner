"""Stage 3: fine-tunes PaddleOCR's English text recognition model (en_PP-OCRv5_mobile_rec) on
the synthetic dot-peen lines. Recognition only (no detection).

Every epoch: training loss, validation loss (the same loss as training, with the model in
evaluation mode: no dropout, fixed batch-norm statistics) and validation exact-match accuracy
(the deployed CTC branch, greedy decoding). Training stops early when the validation loss has not
improved for `--patience` epochs. Train and validation data are synthetic only; this script never
sees a real photo.

Round 2: a checkpoint is saved after EVERY epoch (epochs/epoch_NN.pdparams, only the parts used for
reading: backbone + CTC branch, ~22 MB). Which one to use is decided on this Mac with the real
photos (scripts/select_checkpoint.py). best_synth.pdparams = lowest synthetic validation loss.

Usage (Kaggle / any CUDA machine, or CPU for a smoke test):
  python train_rec.py --paddleocr /path/to/PaddleOCR --data /path/to/synth --out /path/to/output
  python train_rec.py ... --smoke     # a few hundred images, 2 epochs: checks the pipeline only
"""
from __future__ import annotations

import argparse
import copy
import csv
import json
import math
import os
import random
import sys
import time
from pathlib import Path

import numpy as np
import yaml

HERE = Path(__file__).resolve().parent
SEED = 20261017
# Parts of the model used only in training (the NRTR branch); not needed to read a line.
TRAINING_ONLY = ("head.gtc_head", "head.before_gtc")


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--paddleocr", required=True, help="PaddleOCR source checkout (v3.7.0)")
    p.add_argument("--data", required=True, help="folder with train/, val/, *_list.txt, dict.txt")
    p.add_argument("--out", required=True)
    p.add_argument("--config", default=str(HERE / "finetune_rec.yml"))
    p.add_argument("--epochs", type=int, default=None)
    p.add_argument("--batch", type=int, default=None)
    p.add_argument("--patience", type=int, default=4)
    p.add_argument("--min-delta", type=float, default=1e-4)
    p.add_argument("--workers", type=int, default=None)
    p.add_argument("--cpu", action="store_true")
    p.add_argument("--smoke", action="store_true", help="tiny subset, 2 epochs (pipeline check)")
    return p.parse_args()


def seed_everything(seed: int) -> None:
    import paddle

    os.environ["FLAGS_cudnn_deterministic"] = "1"
    random.seed(seed)
    np.random.seed(seed)
    paddle.seed(seed)


def subset_list(src: Path, dst: Path, n: int) -> None:
    lines = src.read_text().splitlines()
    rng = random.Random(SEED)
    dst.write_text("\n".join(rng.sample(lines, min(n, len(lines)))) + "\n")


def build_config(args) -> dict:
    cfg = yaml.safe_load(Path(args.config).read_text())
    data = Path(args.data).resolve()
    out = Path(args.out).resolve()
    train_list, val_list = data / "train_list.txt", data / "val_list.txt"
    if args.smoke:
        train_list, val_list = out / "smoke_train.txt", out / "smoke_val.txt"
        subset_list(data / "train_list.txt", train_list, 512)
        subset_list(data / "val_list.txt", val_list, 256)
        cfg["Global"]["epoch_num"] = 2
        for part in ("Train", "Eval"):
            cfg[part]["loader"]["batch_size_per_card"] = 32
    g = cfg["Global"]
    g["character_dict_path"] = str(data / "dict.txt")
    g["use_gpu"] = not args.cpu
    if args.epochs:
        g["epoch_num"] = args.epochs
    for part, lst in (("Train", train_list), ("Eval", val_list)):
        cfg[part]["dataset"]["data_dir"] = str(data)
        cfg[part]["dataset"]["label_file_list"] = [str(lst)]
        if args.batch:
            cfg[part]["loader"]["batch_size_per_card"] = args.batch
        if args.workers is not None:
            cfg[part]["loader"]["num_workers"] = args.workers
    return cfg


def head_eval_with_loss(model):
    """Evaluation mode everywhere (no dropout, fixed BN) except the branch switches, so the heads
    return the training outputs the loss needs (CTC logits + NRTR output)."""
    model.eval()
    head = model.head
    for layer in (head, head.ctc_head, head.gtc_head):
        layer.training = True


def run_eval(model, loader, loss_fn, post_process):
    import paddle

    head_eval_with_loss(model)
    total, n_batches, correct, count = 0.0, 0, 0, 0
    with paddle.no_grad():
        for batch in loader:
            images = batch[0]
            preds = model(images, data=batch[1:])
            loss = loss_fn(preds, batch)["loss"]
            total += float(loss)
            n_batches += 1
            texts, labels = post_process(preds["ctc"].numpy(), batch[1].numpy())
            for (t, _), (l, _) in zip(texts, labels):
                correct += int(t == l)
                count += 1
    model.train()
    return total / max(1, n_batches), correct / max(1, count)


def main() -> None:
    args = parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(Path(args.paddleocr).resolve()))

    import paddle
    from ppocr.data import build_dataloader
    from ppocr.losses import build_loss
    from ppocr.modeling.architectures import build_model
    from ppocr.optimizer import build_optimizer
    from ppocr.postprocess import build_post_process
    from ppocr.utils.logging import get_logger
    from ppocr.utils.save_load import load_pretrained_params

    seed_everything(SEED)
    cfg = build_config(args)
    (out / "config_used.yml").write_text(yaml.safe_dump(cfg, sort_keys=False))
    logger = get_logger(log_file=str(out / "train.log"))
    device = paddle.set_device("gpu" if cfg["Global"]["use_gpu"] and paddle.is_compiled_with_cuda() else "cpu")
    logger.info(f"device {device}, paddle {paddle.__version__}, seed {SEED}")

    train_loader = build_dataloader(cfg, "Train", device, logger)
    val_loader = build_dataloader(cfg, "Eval", device, logger)

    post_process = build_post_process(cfg["PostProcess"], cfg["Global"])
    char_num = len(post_process.character)
    arch = copy.deepcopy(cfg["Architecture"])
    # Same output sizes as PaddleOCR's tools/train.py for a CTC + NRTR MultiHead.
    arch["Head"]["out_channels_list"] = {"CTCLabelDecode": char_num, "NRTRLabelDecode": char_num + 3}
    model = build_model(arch)
    # Pretrained weights: everything except the two output layers (new character set).
    load_pretrained_params(model, cfg["Global"]["pretrained_model"])
    loss_fn = build_loss(cfg["Loss"])
    optimizer, lr_sched, _ = build_optimizer(
        cfg["Optimizer"],
        epochs=cfg["Global"]["epoch_num"],
        step_each_epoch=len(train_loader),
        model=model,
    )

    history = []
    best = {"val_loss": math.inf, "epoch": None}
    stale = 0
    epochs = cfg["Global"]["epoch_num"]
    logger.info(f"{len(train_loader)} train batches, {len(val_loader)} val batches, {epochs} epochs max")

    for epoch in range(1, epochs + 1):
        model.train()
        t0, losses = time.time(), []
        for step, batch in enumerate(train_loader, 1):
            preds = model(batch[0], data=batch[1:])
            loss = loss_fn(preds, batch)["loss"]
            loss.backward()
            optimizer.step()
            optimizer.clear_grad()
            if not isinstance(lr_sched, float):
                lr_sched.step()
            losses.append(float(loss))
            if step % 20 == 0:
                logger.info(f"epoch {epoch} step {step}/{len(train_loader)} loss {np.mean(losses[-20:]):.4f}")
        train_loss = float(np.mean(losses))
        val_loss, val_acc = run_eval(model, val_loader, loss_fn, post_process)
        row = {
            "epoch": epoch,
            "train_loss": round(train_loss, 5),
            "val_loss": round(val_loss, 5),
            "val_exact_match": round(val_acc, 5),
            "lr": round(float(optimizer.get_lr()), 8),
            "seconds": round(time.time() - t0, 1),
        }
        history.append(row)
        logger.info(json.dumps(row))
        with open(out / "history.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(row))
            w.writeheader()
            w.writerows(history)
        state = model.state_dict()
        paddle.save(state, str(out / "last.pdparams"))  # full (for resuming)
        (out / "epochs").mkdir(exist_ok=True)
        reading_only = {k: v for k, v in state.items() if not k.startswith(TRAINING_ONLY)}
        paddle.save(reading_only, str(out / "epochs" / f"epoch_{epoch:02d}.pdparams"))
        if val_loss < best["val_loss"] - args.min_delta:
            best = {"val_loss": val_loss, "val_exact_match": val_acc, "epoch": epoch}
            stale = 0
            paddle.save(reading_only, str(out / "best_synth.pdparams"))
            (out / "best_synth.json").write_text(json.dumps(best, indent=2))
            logger.info(f"new best (lowest validation loss) at epoch {epoch}")
        else:
            stale += 1
            if stale >= args.patience:
                logger.info(f"early stop: no validation-loss improvement for {stale} epochs")
                break

    plot(history, out / "curves.png", best)
    logger.info(f"done. best epoch {best['epoch']}: {json.dumps(best)}")


def plot(history, path: Path, best) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    ep = [h["epoch"] for h in history]
    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 4))
    a.plot(ep, [h["train_loss"] for h in history], label="train loss")
    a.plot(ep, [h["val_loss"] for h in history], label="validation loss")
    if best.get("epoch"):
        a.axvline(best["epoch"], ls="--", c="grey", label=f"lowest synthetic val loss (epoch {best['epoch']})")
    a.set_xlabel("epoch")
    a.legend()
    b.plot(ep, [h["val_exact_match"] for h in history], label="validation exact match", c="green")
    b.set_ylim(0, 1)
    b.set_xlabel("epoch")
    b.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=120)


if __name__ == "__main__":
    main()
