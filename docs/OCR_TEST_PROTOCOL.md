# OCR real-world test protocol

Purpose: measure how well the OCR provider reads **actual engraved serials** with the phones/lighting used on the
shop floor, so thresholds can be tuned and the decision "OCR as a convenience" vs "manual first" is based on data.
No accuracy figure exists yet; do not quote one until this protocol has been run.

OCR in this system only _proposes_ a reading. The operator confirms or corrects it, and it is verified exactly
like manual entry. So the metrics below measure **operator effort saved**, not registration correctness.

## 1. What to prepare

- At least **50 distinct physical parts** per company serial format (more is better), covering every engraving
  type, surface finish and colour in production (e.g. laser-etched, stamped, dot-peen; bright, dark, oily).
- Record the true serial of each part (read by eye, double-checked) in a spreadsheet: `part_id, true_serial,
company, engraving_type, surface`.
- Devices: each phone model operators use (note OS + browser), plus any desktop webcam if used.
- A way to log results: use the table in §4 (a spreadsheet is fine).

## 2. Conditions matrix (take a photo per part per condition)

| Factor   | Levels                                                             |
| -------- | ------------------------------------------------------------------ |
| Lighting | normal workshop light · bright overhead · dim · raking/side light  |
| Glare    | none · visible reflection near the serial                          |
| Angle    | square-on · ~20° tilt · ~40° tilt                                  |
| Distance | close (serial fills the guide box) · medium · far (small in frame) |
| Focus    | sharp · slightly soft (hand shake)                                 |
| Surface  | clean · oily/dirty                                                 |

Do not test every combination: take **the normal condition for all parts**, then add the stress conditions on a
subset of 10 parts.

## 3. Procedure (per photo)

1. Open the scan page on the target phone, choose the company, **Upload Photo (OCR) → Take Photo**.
2. Frame the serial in the guide box, take the photo, press **Read Serial**.
3. Without correcting anything, write down: the **detected text**, the **confidence shown** (or "none"), the
   **confidence level** (high/medium/low/unknown), whether the reading **matched the company format**, and the
   **time** from tap to reading (seconds).
4. Then correct the text if needed and note **how many characters** you had to change and **which** (O/0, I/1,
   B/8, …).
5. Press Confirm only for parts that are _not_ yet registered (use a test company/emulator, or throw-away serials).
   For production data, stop before Confirm.

## 4. Record

`part_id, phone, condition, true_serial, detected, confidence, level, exact_match(Y/N), chars_changed,
confusions, seconds, notes`

## 5. Metrics to compute (report with the sample size)

- **Exact-match rate** = readings identical to the true serial ÷ photos, **per confidence level** (high / medium /
  low / unknown) and per condition.
- **Character error rate** = total characters changed ÷ total characters.
- **Most common confusions** (pairs).
- **Calibration:** among "high" readings, what fraction were wrong? (If non-trivial, raise
  `OCR_CONFIDENCE.high` in `src/config/ocr.ts`.) Among "low" readings, what fraction were right?
- **Time saved:** median seconds photo→confirmed versus manual typing time for the same serials.
- **Failure rate:** photos that produced "Photo not read".

## 6. Decisions the results should drive

- Confidence thresholds (`OCR_CONFIDENCE` in `src/config/ocr.ts`) — placeholders today (high ≥ 85, medium ≥ 65).
- Whether image pre-processing (`services/ocr/tesseractOcr.ts`) needs tuning for the real engraving (contrast,
  scale, thresholding) or another provider should be plugged into the `OCRService` adapter.
- Operator guidance (lighting/angle/distance text on the photo screen).
- Whether OCR stays on the primary scan screen for each phone model.

## 7. Safety checks to repeat on the real devices

- No reading is ever registered without pressing Confirm.
- A medium/low reading cannot be confirmed without ticking "I compared this serial with the engraving".
- Editing the detected text verifies the **edited** value.
- Switching company while a reading is on screen updates the format warning and verifies against the new company.
- The camera opens (rear camera) on each phone/browser; "Choose Photo" works as a fallback; a denied camera
  permission shows the fallback message.
- Photos are not stored (nothing appears in Firebase; the preview disappears after leaving the screen).

Pass criteria are for the factory to set (for example "≥ X % exact match at high confidence, median time saved

> Y s"); none are assumed here.
