/**
 * Downscale + re-encode a photo before upload. Real phone camera photos
 * routinely land at 3-10MB+, well past the backend's upload limit (413
 * Entity Too Large) — this keeps the receipt readable while staying small.
 */
export async function compressImage(file: File, maxDimension = 1600, quality = 0.8): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => undefined);
  if (!bitmap) return file; // decode failed (e.g. unsupported format) — let the backend judge it

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob || blob.size >= file.size) return file; // compression didn't help — keep the original

  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}
