// make.fun "news-image" 2026-11-19 — hand today's front page to the grader.
//
// The page lives next to this module as entry.png. Before a single byte reaches the
// output directory the file must prove it is a still PNG or a JPEG inside the 1024x1024
// and 1 MiB gate; a file that fails any rule stops here with exit 1 and leaves nothing
// behind, so a bad entry is loud instead of silently scored as a blank page.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIDE_MAX = 1024;
const BYTES_MAX = 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

interface Geometry {
  readonly format: 'png' | 'jpeg';
  readonly width: number;
  readonly height: number;
}

/** CRC-32 as PNG defines it: polynomial 0xEDB88320, both ends XOR 0xFFFFFFFF. */
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    value ^= bytes.readUInt8(index);
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(2, '0')}`;
}

/**
 * A PNG header is fixed by the spec: after the 8-byte signature comes a chunk whose
 * length must be 13 and whose type must be IHDR. Verifying its CRC is what separates a
 * real header from bytes somebody patched by hand to pass a size check.
 */
function pngGeometry(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 33) {
    throw new Error(`entry.png is ${bytes.length} bytes, too short for a PNG IHDR chunk`);
  }
  const declared = bytes.readUInt32BE(8);
  const type = bytes.toString('latin1', 12, 16);
  if (declared !== 13 || type !== 'IHDR') {
    throw new Error(
      `entry.png starts with chunk "${type}" of ${declared} bytes where a 13-byte IHDR belongs`,
    );
  }
  const stored = bytes.readUInt32BE(29);
  const computed = crc32(bytes.subarray(12, 29));
  if (stored !== computed) {
    throw new Error(
      `entry.png IHDR CRC mismatch: stored 0x${stored.toString(16)}, computed 0x${computed.toString(16)}`,
    );
  }
  const bitDepth = bytes.readUInt8(24);
  const colourType = bytes.readUInt8(25);
  const compression = bytes.readUInt8(26);
  const filter = bytes.readUInt8(27);
  const interlace = bytes.readUInt8(28);
  if (![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colourType)) {
    throw new Error(
      `entry.png IHDR declares bit depth ${bitDepth} and colour type ${colourType}, which PNG does not allow`,
    );
  }
  if (compression !== 0 || filter !== 0 || interlace > 1) {
    throw new Error(
      `entry.png IHDR uses unsupported compression ${compression}, filter ${filter} or interlace ${interlace}`,
    );
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * An animated PNG keeps its frames in an acTL chunk; a grader that keeps only the first
 * frame would score a still of the page rather than the page, so it is refused outright.
 */
function rejectAnimation(bytes: Buffer): void {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (type === 'acTL') {
      throw new Error('entry.png is an animated PNG (acTL chunk); the page must be one still frame');
    }
    if (type === 'IEND') {
      return;
    }
    if (offset + 12 + length > bytes.length) {
      throw new Error(
        `entry.png is not a valid PNG: chunk "${type}" at byte ${offset} claims ${length} bytes past the end of the file`,
      );
    }
    offset += length + 12;
  }
  throw new Error('entry.png is not a valid PNG: the chunk list ends without an IEND chunk');
}

/** Markers that carry no length field: TEM and the restart markers RST0–RST7. */
function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

/** Start-of-frame markers: C0–CF minus DHT (C4), JPG (C8) and DAC (CC). */
function startsFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * A JPEG hides its size in the first start-of-frame segment of the marker chain. Segments
 * are skipped by their own length field; inside entropy-coded scan data a 0xFF only starts
 * a marker when the following byte is not 0x00, so compressed bytes are not read as headers.
 */
function jpegGeometry(bytes: Buffer): { width: number; height: number } {
  let offset = 2;
  let insideScan = false;
  while (offset < bytes.length) {
    const current = bytes.readUInt8(offset);
    if (current !== 0xff) {
      if (!insideScan) {
        throw new Error(
          `entry.png is not a valid JPEG: expected a marker at byte ${offset}, found ${hex(current)}`,
        );
      }
      offset += 1;
      continue;
    }
    let start = offset;
    while (start + 1 < bytes.length && bytes.readUInt8(start + 1) === 0xff) {
      start += 1;
    }
    if (start + 1 >= bytes.length) {
      break;
    }
    const marker = bytes.readUInt8(start + 1);
    offset = start + 2;
    if (marker === 0x00) {
      if (!insideScan) {
        throw new Error(`entry.png is not a valid JPEG: stuffed 0xFF outside scan data at byte ${start}`);
      }
      continue;
    }
    if (isStandalone(marker)) {
      insideScan = false;
      continue;
    }
    if (offset + 2 > bytes.length) {
      throw new Error(`entry.png is not a valid JPEG: marker 0x${marker.toString(16)} at byte ${start} has no length field`);
    }
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new Error(
        `entry.png is not a valid JPEG: segment at byte ${offset} declares ${segmentLength} bytes but only ${bytes.length - offset} remain`,
      );
    }
    if (startsFrame(marker)) {
      if (segmentLength < 8) {
        throw new Error(
          `entry.png is not a valid JPEG: start-of-frame at byte ${offset} is only ${segmentLength} bytes`,
        );
      }
      const components = bytes.readUInt8(offset + 7);
      if (components < 1 || segmentLength !== 8 + 3 * components) {
        throw new Error(
          `entry.png is not a valid JPEG: start-of-frame at byte ${offset} declares ${segmentLength} bytes for ${components} components`,
        );
      }
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    if (marker === 0xda) {
      insideScan = true;
    }
    offset += segmentLength;
  }
  throw new Error('entry.png is not a valid JPEG: no start-of-frame segment before the end of the file');
}

/** Byte cap first, then the format gate, then the format's own header parse. */
function inspect(bytes: Buffer): Geometry {
  if (bytes.length > BYTES_MAX) {
    throw new Error(`entry.png is ${bytes.length} bytes, over the ${BYTES_MAX} byte limit`);
  }
  if (bytes.length >= PNG_MAGIC.length && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    const size = pngGeometry(bytes);
    rejectAnimation(bytes);
    return { format: 'png', width: size.width, height: size.height };
  }
  if (bytes.length >= JPEG_MAGIC.length && bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    const size = jpegGeometry(bytes);
    return { format: 'jpeg', width: size.width, height: size.height };
  }
  throw new Error('entry.png is neither a PNG nor a JPEG: the first bytes match no known signature');
}

function assertSize(geometry: Geometry): void {
  const { format, width, height } = geometry;
  if (width < 1 || height < 1) {
    throw new Error(
      `entry.png (${format}) reports ${width}x${height}; both sides must be at least 1 pixel`,
    );
  }
  if (width > SIDE_MAX || height > SIDE_MAX) {
    throw new Error(
      `entry.png (${format}) measures ${width}x${height}, over the ${SIDE_MAX}x${SIDE_MAX} cap`,
    );
  }
}

function outputDirectory(): string {
  const configured = process.env.MAKEFUN_OUTPUT_DIR;
  const wanted = configured === undefined ? '/output' : configured.trim();
  if (wanted === '') {
    throw new Error('MAKEFUN_OUTPUT_DIR is set but empty; it must name the output directory');
  }
  return resolve(wanted);
}

function deliver(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = join(here, 'entry.png');

  let bytes: Buffer;
  try {
    bytes = readFileSync(source);
  } catch (failure) {
    throw new Error(`cannot read ${source}: ${(failure as Error).message}`);
  }

  const geometry = inspect(bytes);
  assertSize(geometry);

  const target = join(outputDirectory(), 'entry.png');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);

  console.log(
    `entry.png ${geometry.width}x${geometry.height} ${geometry.format} ${bytes.length} bytes -> ${target}`,
  );
}

try {
  deliver();
} catch (failure) {
  const message = failure instanceof Error ? failure.message : String(failure);
  console.error(`error: ${message}`);
  process.exit(1);
}
