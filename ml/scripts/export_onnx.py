"""Exports the fine-tuned recognition model (epoch 10) to ONNX for the desktop app, checks it gives
the same output as Paddle, and times it on this computer's CPU. Inputs are synthetic validation
lines only."""
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))
from train.finetuned import FineTuned  # noqa: E402

RUN = ML / "checkpoints" / "run1"
OUT = ML / "models" / "run1_epoch10"
OUT.mkdir(parents=True, exist_ok=True)
m = FineTuned(ML / "third_party" / "PaddleOCR", RUN / "best.pdparams", ML / "data" / "synth" / "dict.txt", RUN / "config_used.yml")

import paddle  # noqa: E402

static = paddle.jit.to_static(m.model, input_spec=[paddle.static.InputSpec([None, 3, 48, 320], "float32", "x")])
paddle.jit.save(static, str(OUT / "inference"))
files = sorted(p.name for p in OUT.iterdir())
model_file = "inference.json" if "inference.json" in files else "inference.pdmodel"
subprocess.run(
    [
        str(Path(sys.executable).parent / "paddle2onnx"),
        "--model_dir", str(OUT),
        "--model_filename", model_file,
        "--params_filename", "inference.pdiparams",
        "--save_file", str(OUT / "rec.onnx"),
        "--opset_version", "14",
        "--enable_onnx_checker", "True",
    ],
    check=True,
)
(OUT / "dict.txt").write_text((ML / "data" / "synth" / "dict.txt").read_text())

import onnxruntime as ort  # noqa: E402

sess = ort.InferenceSession(str(OUT / "rec.onnx"), providers=["CPUExecutionProvider"])
name = sess.get_inputs()[0].name
lines = (ML / "data" / "synth" / "val_list.txt").read_text().splitlines()[:200]
x = np.stack([m.preprocess((ML / "data" / "synth" / l.split("\t")[0]).read_bytes()) for l in lines]).astype(np.float32)
with paddle.no_grad():
    ref = m.model(paddle.to_tensor(x)).numpy()
out = sess.run(None, {name: x})[0]
same_text = sum(a == b for (a, _), (b, _) in zip(m.post(ref), m.post(out)))
# CPU time per line: one line at a time (as the app would read a scan), after warm-up.
for i in range(10):
    sess.run(None, {name: x[i : i + 1]})
t0 = time.perf_counter()
for i in range(200):
    sess.run(None, {name: x[i : i + 1]})
ms = (time.perf_counter() - t0) / 200 * 1000
report = {
    "onnx_file": str((OUT / "rec.onnx").relative_to(ML)),
    "onnx_size_mb": round((OUT / "rec.onnx").stat().st_size / 1e6, 2),
    "input": "float32 [batch, 3, 48, 320]: BGR, resized to height 48 keeping aspect (max width 320), (x/255-0.5)/0.5, right-padded with 0",
    "output_shape": list(out.shape),
    "output": "CTC probabilities; index 0 = blank, then the characters of dict.txt in order",
    "max_abs_diff_vs_paddle": float(np.abs(ref - out).max()),
    "same_text_as_paddle": f"{same_text}/200",
    "cpu_ms_per_line_batch1": round(ms, 2),
    "cpu": "Apple M5, onnxruntime 1.31.0 CPUExecutionProvider (default threads)",
}
(OUT / "onnx_report.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
