# ml/ — reading dot-peen engraved serials (PaddleOCR fine-tuning)

Machine-learning track for the USB-camera feature. Nothing here is part of the desktop app yet.

## Data rules

- **Train and validation:** synthetic only (`data/synth`, made by `scripts/make_dataset.py`).
- **Test:** the 8 real photos in `local/client-data/Engravings.zip` and their answers in
  `local/client-data/labels.csv` (repository root; `local/` is never committed).
  - They are not opened, unpacked, used as textures or crops, or used for tuning before the
    single final evaluation (stage 4).
  - They are never uploaded anywhere, Kaggle included.
- **Brief examples excluded:** the example strings quoted in the task brief (they may be test
  answers) are excluded from the synthetic data.
- **Not in git:** the environment, data, models, checkpoints and client images are in `.gitignore`.

## Tools and licences

| Tool | Version | Licence |
| --- | --- | --- |
| Python (via uv) | 3.12.13 | PSF |
| PaddlePaddle (CPU here; GPU build on Kaggle) | 3.3.1 | Apache-2.0 |
| PaddleOCR (pip package, and source tag `v3.7.0` for training) | 3.7.0 | Apache-2.0 |
| PaddleX (PaddleOCR dependency) | 3.7.2 | Apache-2.0 |
| Model `en_PP-OCRv5_mobile_rec` | PP-OCRv5 | Apache-2.0 |
| Albumentations | 2.0.8 | MIT |
| OpenCV (contrib) | 4.10.0.84 | Apache-2.0 |
| NumPy | 2.3.5 | BSD-3-Clause |
| Pillow | 13.0.0 | MIT-CMU (HPND) |
| Matplotlib | 3.11.2 | PSF-based (Matplotlib licence) |

`requirements.lock.txt` lists every installed package and its version.

There must be exactly one OpenCV package, `opencv-contrib-python`, which PaddleOCR uses.
Albumentations and PaddleOCR's training requirements would each add another OpenCV, and the
copies overwrite each other's `cv2`. A different OpenCV would also change the generated images.
That is why Albumentations is installed with `--no-deps` below.

## Reproduce

```bash
cd ml
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python paddlepaddle==3.3.1 paddleocr==3.7.0 matplotlib
uv pip install --python .venv/bin/python --no-deps albumentations==2.0.8 albucore==0.0.24
uv pip install --python .venv/bin/python scipy simsimd stringzilla
git clone --depth 1 --branch v3.7.0 https://github.com/PaddlePaddle/PaddleOCR.git third_party/PaddleOCR

.venv/bin/python scripts/stage1_check.py     # stage 1: off-the-shelf model on generated strings
.venv/bin/python scripts/make_dataset.py     # stage 2: 20,000 synthetic lines (about 3 min, all cores)
.venv/bin/python kaggle/package.py           # stage 3: zip for Kaggle (synthetic data and code only)
```

**Seeds:** strings and split use seed `20261017`; each image has its own seed, recorded in
`meta.csv`. The dataset build re-generates 40 random images and checks they are byte-identical.
Training seeds Python, NumPy and Paddle, and sets `FLAGS_cudnn_deterministic=1`.

## Layout

| Path | What |
| --- | --- |
| `synth/strings.py` | serial and number lines: unique, balanced per position, split by string |
| `synth/font.py` | stroke font (0–9, A–Z, slashed zero); dots placed along each stroke, 0.8–1.2 dot diameters apart, 9–12 dots per character height |
| `synth/render.py` | procedural green paint and grey metal; dimpled, lit dots; rust; glare |
| `synth/augment.py` | camera angle, crop, blur, distance, JPEG, exposure, noise; difficulty budget |
| `scripts/make_dataset.py` | builds `data/synth` and `out/stage2/contact_sheet.jpg` |
| `train/finetune_rec.yml`, `train/train_rec.py` | fine-tuning (validation loss, early stopping) |
| `kaggle/package.py`, `kaggle/train_kaggle.ipynb` | train on a Kaggle GPU |
| `scripts/crop_lines.py` | round 2 line cropper; builds the local real validation set |
| `scripts/select_checkpoint.py` | scores every epoch on the real photos; picks the checkpoint |
| `scripts/stage4_crop.py`, `scripts/stage4_eval.py`, `scripts/export_onnx.py` | stage 4 (round 1 test, kept as the record) and ONNX export |

## Round 2

- **The 8 original photos are now a real validation set.**
  - They are cropped by `scripts/crop_lines.py` into `data/realval/` (16 lines).
  - They are never used for training and never leave this Mac.
  - They are used only to choose the checkpoint (`scripts/select_checkpoint.py`).
- **The round 2 test set:** the new USB-camera photos, once provided.
- **Cropping:** detection at normal size first, with an upscaled retry when lines are missing or
  tiny. Specks are dropped and slanted lines are kept apart. Orientation is decided once per photo,
  by a confidence-weighted vote over its lines.
- **Data:**
  - **Zero:** the slashed zero is redrawn like the real one (narrow rounded rectangle,
    corner-to-corner slash).
  - **Practice lines:** 3,000 extra lines where 75% of digits are 0/6/8/9.
  - **Difficulty:** 3-heavy-effect images cut to 5%; glare that washes out more than 35% of the
    text area is redrawn.
  - **Marks:** dents and scratches next to lines.
  - **Sharpness:** 35% of non-"far" images are sharp, high-resolution photos.
- **Training:**
  - **Schedule:** learning rate 1e-4, cosine over 20 epochs, patience 4.
  - **Checkpoints:** saved every epoch, reading parts only, about 22 MB each.
  - **Choice:** made on the Mac: the lowest real validation CER, with ties broken by synthetic
    validation loss.

```bash
.venv/bin/python scripts/crop_lines.py            # real validation crops (local only)
.venv/bin/python scripts/make_dataset.py          # 23,000 synthetic lines
.venv/bin/python kaggle/package.py                # Kaggle upload: synthetic data and code only
# ... train on Kaggle, unpack result.zip to checkpoints/run2/ ...
.venv/bin/python scripts/select_checkpoint.py --run checkpoints/run2
```
