# Print calibration checklist (browser printing)

**Nothing in this document has been validated on a physical printer.** The app prints through the browser's print
dialog; the label size and DPI below are development defaults and must be set to the real hardware.

## 1. Where the numbers live

`apps/web/src/config/label.ts` (override at **build time** with env variables, see `.env.example`):

| Setting            | Env variable           | Default | Meaning                                               |
| ------------------ | ---------------------- | ------- | ----------------------------------------------------- |
| Label width        | `VITE_LABEL_WIDTH_MM`  | 70      | physical width; also the printed page width (`@page`) |
| Label height       | `VITE_LABEL_HEIGHT_MM` | 35      | physical height; also the printed page height         |
| Printer resolution | `VITE_LABEL_DPI`       | 203     | used to snap barcode bars to whole printer dots       |

Invalid or out-of-range values (width 20–200 mm, height 10–200 mm, dpi 72–1200) fall back to the defaults.
Barcode length limit: 80 characters; QR: 300 (`LABEL_CODE_LIMITS`).

## 2. Measure the real hardware

- [ ] Printer make/model, connection (USB / network), driver, language (ZPL/TSPL/PDF-capable driver).
- [ ] Printer native resolution (dpi). Set `VITE_LABEL_DPI`.
- [ ] Label stock: **printable** width and height in mm (not the backing paper), gap/mark between labels, corner
      radius, roll vs fan-fold. Set `VITE_LABEL_WIDTH_MM` / `VITE_LABEL_HEIGHT_MM` to the printable label size.
- [ ] Minimum safe margin the printer cannot print into (measure with a test print).

## 3. Browser / driver settings (record the working values)

- [ ] Browser (Chrome/Edge) and version used on the label PC.
- [ ] Paper size selected in the print dialog = the label size (or "match page size").
- [ ] **Margins: None**; **Scale: 100 % / "Actual size"** (not "Fit to page"); headers/footers **off**;
      background graphics on.
- [ ] Driver "paper/label" definition matches the stock; orientation correct; one label per page.
- [ ] Decide on printing from a phone: not a primary workflow; test only if required.

## 4. Test prints (use throw-away serials)

For each of these, print on real stock and note PASS/FAIL:

- [ ] **Size:** label content sits inside the label with even margins; nothing clipped; exactly **one label per
      page** (no blank label feed).
- [ ] **Scale:** measure the printed barcode/QR with a ruler — equals the on-screen/print-copy size (no scaling).
- [ ] **Barcode (Code 128):** bars crisp, no smearing; quiet zone ≥ 10 modules each side; narrowest bar
      (X-dimension) ≥ the scanner's minimum (typical ≥ 0.19 mm / 7.5 mil — a 1-dot module at 203 dpi is
      0.125 mm and is _too narrow_ for many scanners).
- [ ] **QR:** modules square and sharp; quiet zone ≥ 4 modules; error-correction level M.
- [ ] **Human-readable text:** serial, company and part number legible at arm's length (≥ ~2 mm cap height);
      serial text equals the encoded value character for character.
- [ ] **Leading zeros:** print a serial such as `00012345`; read the barcode/QR with the real scanner — result
      must be `00012345`.
- [ ] **Longest real serial:** print the longest serial in use; confirm it still scans (see §5).
- [ ] **Print Again:** prints another identical label; no new serial or scan-log record appears.
- [ ] **Only the label prints:** no page header, navigation, buttons or dashboard.

## 5. Scan tests with the factory scanner(s)

- [ ] Barcode: scan 20 labels at 10 cm, 20 cm and the real working distance; record misreads.
- [ ] QR: same, including a phone camera if operators use one.
- [ ] Angle (±30°) and a slightly curved/dirty surface if labels go on parts.
- [ ] Longest serial: if the barcode fails, either increase the label width, switch that company to **QR**, or
      shorten the serial. (Barcode of 40 characters = 330 modules; at 203 dpi on a 70 mm label it can only be
      printed at 1 dot/module.)

## 6. Record and freeze

Record the final width, height, DPI, browser, printer driver settings and stock part number here, set the three
env variables in the production build, re-run the test prints, and keep this page with the printer.

| Item                           | Value | Date | By  |
| ------------------------------ | ----- | ---- | --- |
| Printer / driver               |       |      |     |
| Label stock                    |       |      |     |
| Width × height (mm)            |       |      |     |
| DPI                            |       |      |     |
| Browser + print settings       |       |      |     |
| Barcode scan distance verified |       |      |     |
| QR scan distance verified      |       |      |     |
