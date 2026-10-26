# Main-stage entry artwork

The QR and NFC record use exactly:

https://agenticreality.space/ads?placement=main_stage_screen

No wallet address, campaign ID, order ID, session or payment authorization belongs in this URL. Opening it does not create a wallet, request funds, open an in-app camera or authorize a payment.

## Normal build

Run `node scripts/build-ads-entry.mjs`. It reads this folder's fixed QR matrix, outlined SVG and source PDF, and generates the public QR SVG/PNG, poster SVG/PNG, access JSON and A5 PDF under `dist/assets/`. The production build needs only the existing Sharp dependency. Do not edit generated public assets by hand.

## Reauthor the source

1. Use Python with ReportLab and Pillow: `python scripts/build-ads-entry-source.py --matrix-only`.
2. Edit `main-stage-poster.template.svg` for the message or layout.
3. Outline the existing licensed `media/fonts/DM-Sans.ttf` using a local Canvas authoring tool: `node scripts/build-ads-entry-artwork.mjs <absolute @napi-rs/canvas directory>`. The authoring dependency is not needed by the production build. Font terms remain in `media/fonts/OFL.txt`.
4. Run `node scripts/build-ads-entry.mjs --artwork-only`, then `python scripts/build-ads-entry-source.py`, then `node scripts/build-ads-entry.mjs`.
5. Render the final PDF, inspect the page and decode the QR independently. The PDF must remain one page, 148 by 210 mm. Print at 100% scale on matte paper without cropping the QR's white border.

The A5 sign is also used as the tappable panel next to the main-stage screen in the digital twin. Its separate timing panel displays only fresh canonical playback timing; it never changes delivery accounting.

## NFC hardware

Program a physical NFC tag as an **NDEF URI** using the exact URL above. QR and NFC are alternative entry methods. The artwork does not itself program a tag or prove that one is installed. Physical printing, tag programming and testing with Android/iPhone remain onsite validation tasks. No QR or NFC marker claims shared physical AR alignment.
