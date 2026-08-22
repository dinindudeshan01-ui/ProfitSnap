// Server-side image preprocessing — ported 1:1 from the original
// profitsnap-backend's src/imageProcessing.js. Same reasoning still
// applies: compressing here (not just trusting whatever the browser sent)
// keeps Gemini's per-scan cost predictable, since image tokenization is
// roughly tied to pixel dimensions.

import sharp from 'sharp';

const MAX_DIMENSION = 1280; // plenty for OCR on a handwritten A4/notebook page
const JPEG_QUALITY = 80; // good balance of legibility vs file size

/**
 * Resizes + re-encodes an image buffer for cost-efficient OCR.
 */
export async function prepareImageForOcr(inputBuffer: Buffer): Promise<Buffer> {
  return sharp(inputBuffer)
    .rotate() // auto-orient based on EXIF, since phone/camera photos often need this
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}
