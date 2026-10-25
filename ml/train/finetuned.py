"""Loads the fine-tuned recognition model (a checkpoint from train_rec.py) for prediction, with
exactly the preprocessing used in training and validation (PaddleOCR's DecodeImage +
RecResizeImg 3x48x320) and greedy CTC decoding (the deployed branch).
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path

import numpy as np
import yaml


class FineTuned:
    def __init__(self, paddleocr_dir: str | Path, checkpoint: str | Path, dict_path: str | Path, config: str | Path):
        sys.path.insert(0, str(Path(paddleocr_dir).resolve()))
        import paddle
        from ppocr.data import create_operators, transform
        from ppocr.modeling.architectures import build_model
        from ppocr.postprocess import build_post_process

        self._paddle = paddle
        self._transform = transform
        cfg = yaml.safe_load(Path(config).read_text())
        cfg["Global"]["character_dict_path"] = str(dict_path)
        self.post = build_post_process(cfg["PostProcess"], cfg["Global"])
        n = len(self.post.character)
        arch = copy.deepcopy(cfg["Architecture"])
        arch["Head"]["out_channels_list"] = {"CTCLabelDecode": n, "NRTRLabelDecode": n + 3}
        self.model = build_model(arch)
        self.load(checkpoint)
        self.ops = create_operators(
            [
                {"DecodeImage": {"img_mode": "BGR", "channel_first": False}},
                {"RecResizeImg": {"image_shape": [3, 48, 320]}},
                {"KeepKeys": {"keep_keys": ["image"]}},
            ],
            cfg["Global"],
        )

    def load(self, checkpoint: str | Path) -> None:
        """Loads weights (a full checkpoint, or one with only the reading parts: the NRTR
        branch is used in training only, so it may be missing)."""
        state = self._paddle.load(str(checkpoint))
        missing = [k for k in self.model.state_dict() if k not in state]
        assert all(k.startswith(("head.gtc_head", "head.before_gtc")) for k in missing), missing[:5]
        self.model.set_state_dict(state)
        self.model.eval()

    def preprocess(self, image_bytes: bytes) -> np.ndarray:
        return self._transform({"image": image_bytes}, self.ops)[0]

    def predict_bytes(self, images: list[bytes], batch: int = 64) -> list[tuple[str, float]]:
        out: list[tuple[str, float]] = []
        with self._paddle.no_grad():
            for i in range(0, len(images), batch):
                x = np.stack([self.preprocess(b) for b in images[i : i + batch]])
                probs = self.model(self._paddle.to_tensor(x)).numpy()
                out += [(t, float(c)) for t, c in self.post(probs)]
        return out
