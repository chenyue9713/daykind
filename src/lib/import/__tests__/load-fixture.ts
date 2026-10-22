import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

export const loadFixture = (name: string) => new Uint8Array(readFileSync(fixturePath(name)));
