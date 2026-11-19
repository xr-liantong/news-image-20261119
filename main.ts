// Entry for make.fun "news-image-20261118": copies the final front page (entry.png) of 18 Nov 2026
// to the output directory, after checking it is a PNG/JPEG that fits the 1024×1024, 1 MiB gate.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_BYTES = 1048576;
const MAX_SIDE = 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(bytes: Buffer, signature: number[]): boolean {
  return bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);
}

/** CRC-32 over the chunk type and data, as the PNG specification defines it. */
function crc32(typeAndData: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of typeAndData) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Dimensions from the PNG IHDR chunk, which must be the first chunk after the signature:
 * big-endian 32-bit width at offset 16, height at offset 20, inside a 13-byte IHDR of valid CRC.
 */
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 33) {
    throw new Error('PNG is too short to hold an IHDR chunk');
  }
  const ihdrLength = bytes.readUInt32BE(8);
  if (ihdrLength !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('PNG is missing its IHDR header');
  }
  if (crc32(bytes.subarray(12, 29)) !== bytes.readUInt32BE(29)) {
    throw new Error('PNG IHDR chunk has a bad CRC');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Markers that stand alone and carry no length field: TEM, RST0–RST7, SOI, EOI. */
function isStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

/** Start-of-frame markers FFC0–FFCF, excluding DHT (FFC4), JPG (FFC8) and DAC (FFCC). */
function isStartOfFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Dimensions from the JPEG start-of-frame segment, found by walking the marker chain.
 * Segments are skipped by their length; the entropy-coded scan after SOS is walked as marker
 * pairs (FF00 stuffing, RSTn) so a stray 0xFF in compressed data is never mistaken for a frame.
 */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4) {
    throw new Error('JPEG is too short to hold a segment');
  }
  let offset = 2; // skip the SOI marker
  let inScan = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      if (inScan) {
        offset += 1; // entropy-coded byte between markers
        continue;
      }
      throw new Error(`JPEG marker chain broken at byte ${offset}`);
    }
    let markerOffset = offset;
    while (markerOffset + 1 < bytes.length && bytes[markerOffset + 1] === 0xff) {
      markerOffset += 1; // fill bytes before the marker proper
    }
    if (markerOffset + 1 >= bytes.length) break;
    const marker = bytes[markerOffset + 1];
    offset = markerOffset + 2;
    if (marker === 0x00) {
      if (!inScan) {
        throw new Error(`JPEG has a stuffed 0xFF outside a scan at byte ${markerOffset}`);
      }
      continue; // FF00 in scan data is a literal 0xFF byte
    }
    if (isStandaloneMarker(marker)) {
      inScan = false; // RSTn ends one restart interval; the next SOS continues a new scan
      continue;
    }
    if (offset + 2 > bytes.length) {
      throw new Error(`JPEG marker at byte ${markerOffset} has no length field`);
    }
    const segmentLength = bytes.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) {
      throw new Error(`JPEG segment at byte ${offset} has an invalid length`);
    }
    if (isStartOfFrameMarker(marker)) {
      const components = bytes[offset + 7]; // offset is the length field; +2 precision, +3/+5 axes, +7 count
      const expectedLength = 8 + 3 * components; // length field, precision, 2 axes, component count
      if (segmentLength !== expectedLength || components < 1) {
        throw new Error(`JPEG start-of-frame segment at byte ${offset} has a bad length`);
      }
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    if (marker === 0xda) {
      inScan = true; // SOS: entropy-coded data follows until the next real marker
    }
    offset = segmentEnd;
  }
  throw new Error('JPEG has no start-of-frame marker');
}

function validate(bytes: Buffer): { format: 'png' | 'jpeg'; width: number; height: number } {
  if (bytes.length > MAX_BYTES) {
    throw new Error(`entry.png is ${bytes.length} bytes, over the ${MAX_BYTES} byte limit`);
  }
  const format = startsWith(bytes, PNG_SIGNATURE) ? 'png' : startsWith(bytes, JPEG_SIGNATURE) ? 'jpeg' : null;
  if (!format) {
    throw new Error('entry.png is neither PNG nor JPEG (bad signature)');
  }
  const { width, height } = format === 'png' ? pngSize(bytes) : jpegSize(bytes);
  if (width < 1 || height < 1) {
    throw new Error(`entry.png has invalid dimensions ${width}x${height}`);
  }
  if (width > MAX_SIDE || height > MAX_SIDE) {
    throw new Error(`entry.png is ${width}x${height}, over the ${MAX_SIDE}x${MAX_SIDE} limit`);
  }
  return { format, width, height };
}

function main(): void {
  // MAKEFUN_OUTPUT_DIR replaces the grader's /output; it may be relative to the current directory.
  const configuredDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  if (!configuredDir.trim()) {
    throw new Error('MAKEFUN_OUTPUT_DIR is set but empty');
  }
  const outputDir = resolve(configuredDir);
  const sourceUrl = new URL('./entry.png', import.meta.url);
  const target = join(outputDir, 'entry.png');

  let bytes: Buffer;
  try {
    bytes = readFileSync(sourceUrl);
  } catch (error) {
    throw new Error(`cannot read ${sourceUrl.pathname}: ${(error as Error).message}`);
  }

  const { format, width, height } = validate(bytes);

  mkdirSync(outputDir, { recursive: true }); // creates missing parents too
  writeFileSync(target, bytes);

  console.log(`entry.png ${width}x${height} ${format} ${bytes.length} bytes -> ${target}`);
}

try {
  main();
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exit(1);
}
