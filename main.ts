// Entry for make.fun "news-image-20261119" — Thursday 19 November 2026, one front page.
//
// The program has one job: hand the finished front page to the grader. It finds entry.png
// next to itself, proves that file is a PNG or a JPEG inside the competition's 1024x1024 and
// 1 MiB gate, and copies it byte for byte into the output directory. Nothing is written when
// a check fails, so a broken entry fails loudly here instead of being scored as a blank page.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIDE_LIMIT = 1024;
const BYTE_LIMIT = 1024 * 1024;

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex');

interface Size {
  width: number;
  height: number;
}

/** The CRC-32 the PNG specification puts at the end of every chunk. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A PNG starts with an IHDR chunk of exactly 13 bytes: width and height as big-endian 32-bit
 * values at offsets 16 and 20 of the file. Its CRC covers the chunk type and the data, so a
 * header that was edited by hand is caught here rather than trusted.
 */
function pngSize(bytes: Buffer): Size {
  if (bytes.length < 33) {
    throw new Error('PNG ends before its IHDR chunk');
  }
  const declared = bytes.readUInt32BE(8);
  const type = bytes.toString('latin1', 12, 16);
  if (declared !== 13 || type !== 'IHDR') {
    throw new Error(`PNG does not start with a 13-byte IHDR chunk (found ${type})`);
  }
  if (crc32(bytes.subarray(12, 29)) !== bytes.readUInt32BE(29)) {
    throw new Error('PNG IHDR chunk fails its own CRC');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Markers with no length field of their own: the two signatures and the restart markers. */
function standsAlone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

/** Start-of-frame markers: FFC0–FFCF except DHT, JPG and DAC, which share the range. */
function startsFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

/**
 * A JPEG keeps its size in the start-of-frame segment, which sits somewhere in the marker chain
 * after the signature. Segments are stepped over by their own length; inside the entropy-coded
 * scan a 0xFF is only a marker when the next byte is not zero, so compressed data is not read
 * as a header by accident.
 */
function jpegSize(bytes: Buffer): Size {
  if (bytes.length < 4) {
    throw new Error('JPEG ends before its first segment');
  }
  let at = 2;
  let inScan = false;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) {
      if (!inScan) {
        throw new Error(`JPEG marker chain breaks at byte ${at}`);
      }
      at += 1;
      continue;
    }
    let mark = at;
    while (mark + 1 < bytes.length && bytes[mark + 1] === 0xff) {
      mark += 1;
    }
    if (mark + 1 >= bytes.length) {
      break;
    }
    const marker = bytes[mark + 1];
    at = mark + 2;
    if (marker === 0x00) {
      if (!inScan) {
        throw new Error(`JPEG has a stuffed 0xFF outside a scan at byte ${mark}`);
      }
      continue;
    }
    if (standsAlone(marker)) {
      inScan = false;
      continue;
    }
    if (at + 2 > bytes.length) {
      throw new Error(`JPEG marker at byte ${mark} carries no length`);
    }
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > bytes.length) {
      throw new Error(`JPEG segment at byte ${at} declares an impossible length`);
    }
    if (startsFrame(marker)) {
      const components = bytes[at + 7];
      if (length !== 8 + 3 * components || components < 1) {
        throw new Error(`JPEG start-of-frame segment at byte ${at} is malformed`);
      }
      return { width: bytes.readUInt16BE(at + 5), height: bytes.readUInt16BE(at + 3) };
    }
    if (marker === 0xda) {
      inScan = true;
    }
    at += length;
  }
  throw new Error('JPEG has no start-of-frame segment');
}

/**
 * An animated PNG carries an acTL chunk before its first frame, and a grader that saves only
 * the first frame would score a still of the page rather than the page. Chunks are walked by
 * their own length so only real chunk types are matched.
 */
function pngIsAnimated(bytes: Buffer): boolean {
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    if (type === 'acTL') {
      return true;
    }
    if (type === 'IEND') {
      return false;
    }
    at += 12 + length;
  }
  return false;
}

function measure(bytes: Buffer): { format: string; size: Size } {
  if (bytes.length > BYTE_LIMIT) {
    throw new Error(`entry.png is ${bytes.length} bytes, past the ${BYTE_LIMIT} byte cap`);
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (pngIsAnimated(bytes)) {
      throw new Error('entry.png is an animated PNG; the page must be one still frame');
    }
    return { format: 'png', size: pngSize(bytes) };
  }
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    return { format: 'jpeg', size: jpegSize(bytes) };
  }
  throw new Error('entry.png is neither a PNG nor a JPEG');
}

function outputDir(): string {
  const configured = (process.env.MAKEFUN_OUTPUT_DIR ?? '/output').trim();
  if (configured === '') {
    throw new Error('MAKEFUN_OUTPUT_DIR is set but empty');
  }
  return resolve(configured);
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = join(here, 'entry.png');
  let bytes: Buffer;
  try {
    bytes = readFileSync(source);
  } catch (error) {
    throw new Error(`cannot read ${source}: ${(error as Error).message}`);
  }

  const { format, size } = measure(bytes);
  if (size.width < 1 || size.height < 1) {
    throw new Error(`entry.png measures ${size.width}x${size.height}, which is not an image`);
  }
  if (size.width > SIDE_LIMIT || size.height > SIDE_LIMIT) {
    throw new Error(`entry.png measures ${size.width}x${size.height}, past ${SIDE_LIMIT}x${SIDE_LIMIT}`);
  }

  const target = join(outputDir(), 'entry.png');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`entry.png ${size.width}x${size.height} ${format} ${bytes.length} bytes -> ${target}`);
}

try {
  main();
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exit(1);
}
