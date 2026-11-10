import * as yauzl from "yauzl-promise";

/**
 * Reads the entries of a ZIP archive (3MF) whose name passes the filter.
 * Names are kept as stored in the archive, without a leading slash.
 */
export async function readZipEntries(
  filePath: string,
  filter: (name: string) => boolean,
): Promise<Map<string, Buffer>> {
  const zip = await yauzl.open(filePath);
  const entries = new Map<string, Buffer>();

  try {
    for await (const entry of zip) {
      const name = entry.filename.replace(/^\/+/, "");
      if (!filter(name)) continue;

      const stream = await entry.openReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      entries.set(name, Buffer.concat(chunks));
    }
  } finally {
    await zip.close();
  }

  return entries;
}
