'use client';

// Compresses any image File/Blob down to WebP under a target size,
// entirely client-side (canvas), before it ever reaches Supabase Storage.
// Used by the signup photo step, and reusable anywhere else a photo gets
// uploaded (product photos, etc.) later.

interface OptimizeOptions {
  maxDimension?: number; // longest side, px
  targetBytes?: number; // aim to land under this
  startQuality?: number; // 0-1, first attempt
  minQuality?: number; // floor — won't go below this even if still over target
}

export async function optimizeImageToWebp(
  file: File | Blob,
  opts: OptimizeOptions = {}
): Promise<Blob> {
  const { maxDimension = 800, targetBytes = 100 * 1024, startQuality = 0.82, minQuality = 0.4 } = opts;

  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported on this device');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  async function encode(quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Encoding failed'))),
        'image/webp',
        quality
      );
    });
  }

  // Step quality down until under target size or we hit the floor.
  let quality = startQuality;
  let blob = await encode(quality);
  while (blob.size > targetBytes && quality > minQuality) {
    quality = Math.max(minQuality, quality - 0.12);
    blob = await encode(quality);
  }

  return blob;
}

// Convenience: turn a Blob into an object URL for local <img> preview
// before upload. Caller is responsible for revokeObjectURL when done.
export function previewUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
