"""Stage 1: load the off-the-shelf PaddleOCR English recognition model and run it on generated,
plain-printed strings (never the real engraving photos)."""
import random
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from paddleocr import TextRecognition

SEED = 1
OUT = Path(__file__).resolve().parent.parent / "out" / "stage1"
MODEL = "en_PP-OCRv5_mobile_rec"


def random_serial(rng: random.Random) -> str:
    L, D = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "0123456789"
    pick = lambda s, n: "".join(rng.choice(s) for _ in range(n))
    return pick(D, 2) + "W" + pick(L, 2) + pick(D, 5) + pick(L, 1) + "26"


def render(text: str) -> np.ndarray:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Courier New Bold.ttf", 40)
    w = int(font.getlength(text)) + 30
    img = Image.new("RGB", (w, 64), "white")
    ImageDraw.Draw(img).text((15, 10), text, font=font, fill="black")
    return np.array(img)


def main() -> None:
    rng = random.Random(SEED)
    strings = [random_serial(rng) for _ in range(3)] + ["".join(rng.choice("0123456789") for _ in range(n)) for n in (8, 12)]
    OUT.mkdir(parents=True, exist_ok=True)
    model = TextRecognition(model_name=MODEL)
    for s in strings:
        img = render(s)
        Image.fromarray(img).save(OUT / f"{s}.png")
        t0 = time.perf_counter()
        res = model.predict(img[:, :, ::-1])[0]  # model expects BGR
        ms = (time.perf_counter() - t0) * 1000
        text, score = res["rec_text"], float(res["rec_score"])
        print(f"{s:>14}  ->  {text:<16} score {score:.3f}  {'OK ' if text == s else 'DIFF'}  {ms:.0f} ms")


if __name__ == "__main__":
    main()
