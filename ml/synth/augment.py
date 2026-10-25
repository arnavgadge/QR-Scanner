"""From a rendered plate to a photographed, cropped text line (PaddleOCR recognition input).

Order follows how the real photo is made: rust and glare on the plate -> camera angle (rotation,
skew, perspective) -> crop around the text line (loose or tight, like a detector) -> motion /
defocus blur -> distance (low resolution) -> phone/WhatsApp JPEG compression -> exposure and
colour -> sensor noise -> stored at height 48 (the model's input height).
Every random choice comes from one seeded generator per image, so a run can be reproduced.
"""
from __future__ import annotations

import albumentations as A
import cv2
import numpy as np

from . import render

OUT_HEIGHT = 48

_GEOMETRY = A.Compose(
    [
        A.Affine(
            rotate=(-5, 5),
            shear={"x": (-10, 10), "y": (-3, 3)},
            scale=(0.95, 1.05),
            border_mode=cv2.BORDER_REPLICATE,
            p=0.9,
        ),
        A.Perspective(scale=(0.02, 0.07), keep_size=True, border_mode=cv2.BORDER_REPLICATE, p=0.6),
    ],
    keypoint_params=A.KeypointParams(format="xy", remove_invisible=False),
)

_BLUR = A.OneOf(
    [
        A.MotionBlur(blur_limit=(3, 11), p=1),
        A.Defocus(radius=(1, 3), alias_blur=(0.1, 0.3), p=1),
        A.GaussianBlur(blur_limit=(3, 7), p=1),
    ],
    p=1,
)
_LIGHT_BLUR = A.GaussianBlur(blur_limit=(3, 3), p=0.3)

# Heavy effects. Each image gets 0-3 of them (difficulty budget), so the dataset has easy, medium
# and hard lines but few that nobody could read (glare + rust + blur + low resolution at once).
HEAVY = ("rust", "glare", "blur", "low_res", "strong_jpeg")
# Round 2: 3 heavy effects cut from 15% to 5% (most of those were unreadable even to a person).
HEAVY_COUNT_P = (0.25, 0.40, 0.30, 0.05)
GLARE_WASHOUT_MAX = 0.35  # redraw if glare blows out more than this share of the text area
HIGH_RES_SHARE = 0.35  # of the images without "low_res": sharp, high-resolution photos

_PHOTO = A.Compose(
    [
        A.RandomBrightnessContrast(brightness_limit=0.25, contrast_limit=0.3, p=0.8),
        A.RandomGamma(gamma_limit=(70, 150), p=0.4),
        A.HueSaturationValue(hue_shift_limit=8, sat_shift_limit=25, val_shift_limit=15, p=0.5),
        A.RGBShift(r_shift_limit=12, g_shift_limit=12, b_shift_limit=12, p=0.3),
        A.GaussNoise(std_range=(0.01, 0.06), p=0.5),
    ]
)


MAX_ATTEMPTS = 20


def make_sample(text: str, seed: int) -> tuple[np.ndarray, dict]:
    """One synthetic line image (uint8 BGR, height 48) and what was applied to it.

    A draw is rejected (and drawn again, reproducibly) if the camera angle pushed part of the text
    off the plate, or the image ended up nearly black/white or without contrast.
    """
    for attempt in range(MAX_ATTEMPTS):
        out, info = _attempt(text, np.random.SeedSequence([seed, attempt]))
        if out is not None:
            info["attempt"] = attempt
            return out, info
    raise RuntimeError(f"no acceptable image for {text!r} (seed {seed})")


def _attempt(text: str, seq: np.random.SeedSequence):
    rng = np.random.default_rng(seq)
    for t in (_GEOMETRY, _BLUR, _LIGHT_BLUR, _PHOTO):
        t.set_random_seed(int(rng.integers(2**31)))
    k = int(rng.choice(len(HEAVY_COUNT_P), p=HEAVY_COUNT_P))
    heavy = set(rng.choice(HEAVY, size=k, replace=False).tolist())

    img, corners, info = render.render_line(rng, text)
    info["heavy"] = sorted(heavy)
    text_h = float(corners[:, 1].max() - corners[:, 1].min())
    info["rust"] = render.rust(rng, img, corners, text_h) if "rust" in heavy else 0
    info["glare"] = render.glare(rng, img, corners, text_h) if "glare" in heavy else 0
    if info["glare"]:
        (gx0, gy0), (gx1, gy1) = corners.min(0).astype(int), corners.max(0).astype(int)
        box = img[max(0, gy0) : gy1, max(0, gx0) : gx1]
        washed = float((box.min(axis=2) > 0.92).mean()) if box.size else 0.0
        if washed > GLARE_WASHOUT_MAX:
            return None, info  # glare washed out most of the line: nobody could read it
    img8 = (img * 255).astype(np.uint8)

    # Camera angle; the text box moves with the image.
    g = _GEOMETRY(image=img8, keypoints=corners)
    img8, pts = g["image"], np.array(g["keypoints"], np.float32)
    h, w = img8.shape[:2]
    if pts.shape != (4, 2) or pts.min() < 0 or pts[:, 0].max() > w or pts[:, 1].max() > h:
        return None, info  # text pushed off the plate

    # Crop around the text line like a detector would: sometimes loose, sometimes tight.
    (xa, ya), (xb, yb) = pts.min(0), pts.max(0)
    th = yb - ya
    top, bottom = rng.uniform(0.04, 0.35) * th, rng.uniform(0.04, 0.35) * th
    left, right = rng.uniform(0.02, 0.45) * th, rng.uniform(0.02, 0.45) * th
    x0, x1 = int(max(0, xa - left)), int(min(w, xb + right))
    y0, y1 = int(max(0, ya - top)), int(min(h, yb + bottom))
    crop = img8[y0:y1, x0:x1]

    crop = (_BLUR if "blur" in heavy else _LIGHT_BLUR)(image=crop)["image"]

    # Distance / phone resolution: the line is ~20-64 px tall in the photo (below ~20 px a 7-dot
    # character has under 3 px per dot row and nobody could read it); 20-30 px is "far".
    if "low_res" in heavy:
        lo, hi = 20, 30
    elif rng.random() < HIGH_RES_SHARE:
        lo, hi = 64, 140  # sharp, close-up photo (the real crops were 110-170 px tall)
    else:
        lo, hi = 30, 64
    small_h = int(round(np.exp(rng.uniform(np.log(lo), np.log(hi)))))
    scale = small_h / crop.shape[0]
    small = cv2.resize(crop, (max(8, int(crop.shape[1] * scale)), small_h), interpolation=cv2.INTER_AREA)
    info["photo_height"] = small_h

    # Phone / WhatsApp compression happens at that resolution.
    if "strong_jpeg" in heavy or rng.random() < 0.75:
        q = int(rng.integers(20, 46)) if "strong_jpeg" in heavy else int(rng.integers(50, 93))
        ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, q])
        small = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        info["jpeg"] = q
    else:
        info["jpeg"] = None

    small = _PHOTO(image=small)["image"]
    out_w = max(16, int(round(small.shape[1] * OUT_HEIGHT / small.shape[0])))
    out = cv2.resize(small, (out_w, OUT_HEIGHT), interpolation=cv2.INTER_LINEAR)
    grey = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    if not (25 <= grey.mean() <= 235) or grey.std() < 6:
        return None, info  # exposure destroyed the image
    return out, info
