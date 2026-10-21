import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fitFixtures, tcxFixtures } from "./fixture-specs";
import { fixturePath } from "./load-fixture";

const update = process.env.UPDATE_FIXTURES === "1";

describe("committed fixtures", () => {
  const all: [string, Uint8Array][] = [
    ...Object.entries(fitFixtures()),
    ...Object.entries(tcxFixtures()).map(([name, text]) => [name, new TextEncoder().encode(text)] as [string, Uint8Array]),
  ];

  it.each(all)("%s matches its generator", (name, bytes) => {
    const path = fixturePath(name);
    if (update || !existsSync(path)) writeFileSync(path, bytes);
    expect(Buffer.compare(readFileSync(path), Buffer.from(bytes))).toBe(0);
  });
});
