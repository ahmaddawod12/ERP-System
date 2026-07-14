import {
  JobAttachmentMimeTypeSchema,
  type UploadAttachmentManifest,
} from '@smart-job/api-contracts';

export type JobAttachmentMimeType = UploadAttachmentManifest['mimeType'];

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length)).toLowerCase();
}

export function detectJobAttachmentMimeType(
  bytes: Uint8Array,
): JobAttachmentMimeType | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && ascii(bytes, 1, 3) === 'png'
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12
    && ascii(bytes, 0, 4) === 'riff'
    && ascii(bytes, 8, 4) === 'webp'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brands = new Set<string>();
    for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
      brands.add(ascii(bytes, offset, 4));
    }
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].some((brand) => brands.has(brand))) {
      return 'image/heic';
    }
    if (['heif', 'mif1', 'msf1'].some((brand) => brands.has(brand))) {
      return 'image/heif';
    }
  }
  return null;
}

export function requireJobAttachmentMimeType(
  bytes: Uint8Array,
  declaredMimeType?: string | null,
): JobAttachmentMimeType {
  const detected = detectJobAttachmentMimeType(bytes);
  if (!detected) {
    throw new Error('The attachment is not a supported image');
  }
  if (declaredMimeType) {
    const declared = JobAttachmentMimeTypeSchema.parse(declaredMimeType.toLowerCase());
    if (declared !== detected) {
      throw new Error('The attachment content does not match its MIME type');
    }
  }
  return detected;
}

export function jobAttachmentExtension(mimeType: JobAttachmentMimeType): string {
  switch (mimeType) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    default: return 'jpg';
  }
}
