/* Full-rate laps, decoded in the browser.
 *
 * The bytes are written by proctor_parser.samples.encode_lap (Python) and are
 * the definition of the format; this is its reader. Per channel: an int32
 * first value, then (n-1) tick-to-tick deltas stored as byte planes (all low
 * bytes, then all high bytes) at 2 or 4 bytes wide, the whole lap zlib-
 * compressed. The header names every channel and its step, so nothing here
 * knows the channel list in advance.
 *
 * Decompression uses the platform's own DecompressionStream("deflate"), which
 * reads zlib-wrapped data — no dependency. A test decodes bytes produced by the
 * Python encoder, so the two sides cannot drift apart unnoticed.
 *
 * Container (the /samples route): "PRS1", u32 count, then per lap
 * i32 lap_number, u32 header length, header JSON, u32 data length, data.
 * All little-endian. */

export interface SampleChannel {
  k: string;
  scale: number;
  /** delta width in bytes: 2 or 4 */
  w: number;
}

export interface SampleHeader {
  codec: number;
  rate: number;
  n: number;
  lap: number;
  length_m: number;
  start_crossing_s: number | null;
  end_crossing_s: number | null;
  ch: SampleChannel[];
  /** channel -> tick indices that were missing in the file */
  nan: Record<string, number[]>;
}

export interface LapSamples {
  lap: number;
  rate: number;
  n: number;
  header: SampleHeader;
  /** Float64Array per channel; NaN where the file had no value. `t` is
   *  seconds since the start/finish crossing, `d` metres from the line. */
  ch: Record<string, Float64Array>;
}

export const CONTAINER_MAGIC = "PRS1";
export const SUPPORTED_CODEC = 1;

export interface RawLap {
  lap: number;
  header: SampleHeader;
  data: Uint8Array;
}

export function parseContainer(buf: ArrayBuffer): RawLap[] {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== CONTAINER_MAGIC) throw new Error(`not a samples container (magic ${magic})`);
  const count = dv.getUint32(4, true);
  const out: RawLap[] = [];
  let pos = 8;
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const lap = dv.getInt32(pos, true);
    pos += 4;
    const hl = dv.getUint32(pos, true);
    pos += 4;
    const header = JSON.parse(dec.decode(new Uint8Array(buf, pos, hl))) as SampleHeader;
    pos += hl;
    const dl = dv.getUint32(pos, true);
    pos += 4;
    out.push({ lap, header, data: new Uint8Array(buf.slice(pos, pos + dl)) });
    pos += dl;
  }
  return out;
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decode the decompressed channel blocks. */
export function decodeChannels(header: SampleHeader, raw: Uint8Array): Record<string, Float64Array> {
  if (header.codec !== SUPPORTED_CODEC) throw new Error(`unknown samples codec ${header.codec}`);
  const n = header.n;
  const count = Math.max(n - 1, 0);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out: Record<string, Float64Array> = {};
  let pos = 0;
  for (const c of header.ch) {
    const first = dv.getInt32(pos, true);
    pos += 4;
    const v = new Float64Array(n);
    let q = first;
    if (n > 0) v[0] = q * c.scale;
    const w = c.w;
    for (let i = 0; i < count; i++) {
      let d: number;
      if (w === 2) {
        const u = raw[pos + i] | (raw[pos + count + i] << 8);
        d = u >= 0x8000 ? u - 0x10000 : u;
      } else {
        d =
          (raw[pos + i] |
            (raw[pos + count + i] << 8) |
            (raw[pos + 2 * count + i] << 16) |
            (raw[pos + 3 * count + i] << 24)) >>
          0;
      }
      q += d;
      v[i + 1] = q * c.scale;
    }
    pos += count * w;
    for (const idx of header.nan?.[c.k] ?? []) if (idx < n) v[idx] = Number.NaN;
    out[c.k] = v;
  }
  return out;
}

export async function decodeLap(r: RawLap): Promise<LapSamples> {
  const raw = await inflate(r.data);
  return { lap: r.lap, rate: r.header.rate, n: r.header.n, header: r.header, ch: decodeChannels(r.header, raw) };
}

export async function decodeContainer(buf: ArrayBuffer): Promise<LapSamples[]> {
  return Promise.all(parseContainer(buf).map(decodeLap));
}

/** Build a container from rows (server side). Kept here, beside the reader,
 *  so the two halves of the format live in one file. */
export function buildContainer(rows: { lap: number; header: unknown; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const head = new Uint8Array(8);
  head.set(enc.encode(CONTAINER_MAGIC), 0);
  new DataView(head.buffer).setUint32(4, rows.length, true);
  parts.push(head);
  for (const r of rows) {
    const h = enc.encode(JSON.stringify(r.header));
    const pre = new Uint8Array(8);
    const dv = new DataView(pre.buffer);
    dv.setInt32(0, r.lap, true);
    dv.setUint32(4, h.length, true);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, r.data.length, true);
    parts.push(pre, h, len, r.data);
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
