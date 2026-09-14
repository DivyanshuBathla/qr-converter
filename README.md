# QR Converter

A small static website that turns a link into a QR code, and reads a link back
out of a QR code image. Everything runs in the browser — no server, no upload,
no network call once the page is open.

## Running it

Open `index.html` in a browser, and it works.

For the **camera scanner** you need a real origin, because browsers only hand a
page the camera on `https` or `localhost` — not on `file://`. Serve the folder:

```bash
./serve.sh            # or: python3 -m http.server 8000
```

then open <http://localhost:8000>.

## What it does

**Link → QR**
- Any payload: URL, plain text, `mailto:`, `tel:`, Wi-Fi credentials.
- Error correction L / M / Q / H, adjustable size, quiet zone and colours.
- Download as PNG (raster) or SVG (vector, for print), or copy to the clipboard.
- Warns when the colour contrast or quiet zone would stop scanners reading it.

**QR → Link**
- Drop a file, click to browse, or paste an image with `Ctrl+V`.
- Or scan live with the camera.
- Shows the decoded text, the host name, and an Open button for `http(s)`,
  `mailto:` and `tel:` payloads.
- Flags plain `http`, non-ASCII host names, and unusually long links before you
  open them — a QR code hides its destination until it is decoded, so it is
  worth reading the target first.

## Layout

```
index.html    markup
styles.css    styling, light + dark
app.js        all the logic
vendor/
  qrcode-generator.js   encoder  (Kazuhiko Arase, MIT)
  jsQR.js               decoder  (Cosmo Wolfe, Apache-2.0)
```

Both libraries are vendored, so the page works offline.

## How the decoder copes with bad photographs

jsQR is tried first on the image at several scales. Its own binariser is local
and already handles a lot — up to roughly 8x lighting falloff in testing.

When that fails, a second pass runs first. A photograph of a printed code is
multiplicative: `observed = reflectance x illumination`. Illumination varies
slowly across the frame, so a wide box blur estimates it, and dividing it out
leaves reflectance, which one global Otsu threshold separates cleanly.

Measured on synthetic degradations (`reflectance x illumination` + sensor noise
+ defocus), this pass recovers faded print on its own and faded print under 4x
and 8x light falloff, none of which decode without it. It costs about 180 ms on
a 666x666 image and only runs when the direct attempt has already failed.

## Verification

The build was checked with:

- 32 encode → decode round trips (4 error-correction levels x 8 payloads,
  including Devanagari, emoji, `mailto:`, Wi-Fi and a 1000-character string).
- 13 decode trials on degraded images under a physical illumination model.
- 29 browser tests driving the real page in headless Chrome, including reading
  the rendered canvas back and decoding it, and dropping generated PNG files
  onto the dropzone.

All passed. The scripts live outside the repo; the decoder ones read their
functions straight out of `app.js` so they test shipped code rather than a copy.
