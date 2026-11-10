import { inflateSync } from "node:zlib";

/**
 * Reader for Prusa's binary G-code (.bgcode, libbgcode format v1), metadata only.
 *
 * Layout: "GCDE", version (u32), checksum type (u16: 0 none, 1 CRC32), then blocks:
 *   type (u16), compression (u16: 0 none, 1 deflate, 2/3 heatshrink), uncompressed size (u32),
 *   compressed size (u32, only when compressed), parameters (2 bytes; 6 for thumbnails),
 *   data, checksum.
 * Metadata blocks are "key=value" lines. G-code blocks (heatshrink + MeatPack) are skipped.
 */

export const BGCODE_MAGIC = "GCDE";

const BLOCK_TYPES = ["file", "gcode", "slicer", "printer", "print", "thumbnail"] as const;
type BlockType = (typeof BLOCK_TYPES)[number];

export interface BgcodeThumbnail {
  format: "png" | "jpg" | "qoi" | "unknown";
  width: number;
  height: number;
  data: Buffer;
}

export interface BgcodeMetadata {
  file: Map<string, string>;
  printer: Map<string, string>;
  print: Map<string, string>;
  slicer: Map<string, string>;
  thumbnails: BgcodeThumbnail[];
}

export function isBgcode(head: Buffer): boolean {
  return head.length >= 4 && head.toString("ascii", 0, 4) === BGCODE_MAGIC;
}

export function readBgcodeMetadata(buf: Buffer): BgcodeMetadata {
  if (!isBgcode(buf)) throw new Error("Not a binary G-code file");

  const checksumSize = buf.readUInt16LE(8) === 1 ? 4 : 0;
  const meta: BgcodeMetadata = {
    file: new Map(),
    printer: new Map(),
    print: new Map(),
    slicer: new Map(),
    thumbnails: [],
  };

  let offset = 10;
  while (offset + 8 <= buf.length) {
    const typeId = buf.readUInt16LE(offset);
    const compression = buf.readUInt16LE(offset + 2);
    const uncompressedSize = buf.readUInt32LE(offset + 4);
    let headerSize = 8;
    let dataSize = uncompressedSize;
    if (compression !== 0) {
      dataSize = buf.readUInt32LE(offset + 8);
      headerSize = 12;
    }

    const type: BlockType | undefined = BLOCK_TYPES[typeId];
    const paramsSize = type === "thumbnail" ? 6 : 2;
    const paramsStart = offset + headerSize;
    const dataStart = paramsStart + paramsSize;
    const data = buf.subarray(dataStart, dataStart + dataSize);

    if (type === "thumbnail") {
      const format = (["png", "jpg", "qoi"] as const)[buf.readUInt16LE(paramsStart)] ?? "unknown";
      meta.thumbnails.push({
        format,
        width: buf.readUInt16LE(paramsStart + 2),
        height: buf.readUInt16LE(paramsStart + 4),
        data: Buffer.from(data),
      });
    } else if (type && type !== "gcode" && (compression === 0 || compression === 1)) {
      const text = (compression === 1 ? inflateSync(data) : data).toString("utf-8");
      const target = meta[type];
      for (const line of text.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) target.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
      }
    }

    offset = dataStart + dataSize + checksumSize;
  }

  return meta;
}
