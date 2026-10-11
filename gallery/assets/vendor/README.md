# HEIC decoder

`heic-to-1.6.6-csp.js` is the unmodified CSP build from heic-to 1.6.6.
It is loaded from the gallery's own asset endpoint only for an unsupported HEIC.
The main page and decoder keep a CSP without `unsafe-eval`.

- Distribution: https://cdn.jsdelivr.net/npm/heic-to@1.6.6/dist/csp/heic-to.js
- Project / corresponding source: https://github.com/hoppergee/heic-to
- Underlying libheif 1.23.6 source: https://github.com/strukturag/libheif/tree/v1.23.6
- Underlying libde265 source: https://github.com/strukturag/libde265
- License: `heic-to-LICENSE.txt` and `GPL-3.0.txt`. The built decoder endpoint includes both license texts.

The separate application worker imports the decoder and converts one selected
photo to JPEG at its original dimensions. It can be terminated on navigation.
The vendor file is not changed by the builder; the build integration test checks
that its source is preserved byte-for-byte, including literal replacement syntax.
