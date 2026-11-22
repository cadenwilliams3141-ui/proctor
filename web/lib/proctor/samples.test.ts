/* The browser's reader against bytes the Python writer produced. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildContainer, decodeContainer, decodeLap, type SampleHeader } from "@/lib/proctor/samples";

const fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "samples-lap.json"), "utf8")) as {
  lap: number;
  header: SampleHeader;
  data_b64: string;
  expect: Record<string, (number | null)[]>;
};
const bytes = new Uint8Array(Buffer.from(fx.data_b64, "base64"));

describe("full-rate samples, decoded", () => {
  it("matches the Python decoder value for value", async () => {
    const lap = await decodeLap({ lap: fx.lap, header: fx.header, data: bytes });
    expect(lap.n).toBe(fx.header.n);
    for (const [k, want] of Object.entries(fx.expect)) {
      const got = lap.ch[k];
      expect(got, k).toBeDefined();
      want.forEach((w, i) => {
        if (w == null) expect(Number.isNaN(got[i]), `${k}[${i}]`).toBe(true);
        else expect(Math.abs(got[i] - w), `${k}[${i}]`).toBeLessThan(1e-6);
      });
    }
  });

  it("reads a 32-bit channel (a jump too big for 16)", async () => {
    expect(fx.header.ch.find((c) => c.k === "rpm")?.w).toBe(4);
    const lap = await decodeLap({ lap: fx.lap, header: fx.header, data: bytes });
    expect(lap.ch.rpm[100] - lap.ch.rpm[99]).toBeGreaterThan(40000);
  });

  it("puts missing ticks back as gaps, not zeros", async () => {
    const lap = await decodeLap({ lap: fx.lap, header: fx.header, data: bytes });
    expect([50, 51, 52].every((i) => Number.isNaN(lap.ch.fuel[i]))).toBe(true);
    expect(Number.isFinite(lap.ch.fuel[53])).toBe(true);
  });

  it("round-trips through the container the route sends", async () => {
    const buf = buildContainer([
      { lap: 4, header: fx.header, data: bytes },
      { lap: 9, header: fx.header, data: bytes },
    ]);
    const laps = await decodeContainer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(laps.map((l) => l.lap)).toEqual([4, 9]);
    expect(laps[1].ch.speed[10]).toBeCloseTo(fx.expect.speed[10] as number, 6);
  });

  it("refuses a codec it does not know rather than misreading it", async () => {
    await expect(decodeLap({ lap: 1, header: { ...fx.header, codec: 99 }, data: bytes })).rejects.toThrow(/codec/);
  });
});
