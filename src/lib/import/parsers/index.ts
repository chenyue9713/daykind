// The parser boundary: bytes in, normalized ParsedFile (or an actionable
// error) out. Callers never see TCX or FIT details.
import { Deadline } from "../limits";
import { detectFormat } from "../sniff";
import { ImportFailure, type ParseResult } from "../types";
import { parseFit } from "./fit";
import { parseTcx } from "./tcx";

function decodeUtf8Xml(bytes: Uint8Array): string {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new ImportFailure("unsupported_content", "This TCX file uses UTF-16 text encoding. Export it again from Garmin Connect, which uses UTF-8.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ImportFailure("corrupt", "This TCX file contains invalid text characters. Export the workout again.");
  }
  const declared = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(text)?.[1]?.toLowerCase();
  if (declared && !["utf-8", "utf8", "us-ascii", "ascii"].includes(declared)) {
    throw new ImportFailure("unsupported_content", `This TCX file declares the “${declared.slice(0, 20)}” encoding. Only UTF-8 TCX files are supported.`);
  }
  return text;
}

export interface ParseOptions {
  deadline?: Deadline;
}

export function parseWorkoutFile(bytes: Uint8Array, fileName: string | null, options: ParseOptions = {}): ParseResult {
  const deadline = options.deadline ?? new Deadline();
  try {
    const format = detectFormat(bytes, fileName);
    const file = format === "fit" ? parseFit(bytes, deadline) : parseTcx(decodeUtf8Xml(bytes), deadline);
    return { ok: true, file };
  } catch (error) {
    if (error instanceof ImportFailure) return { ok: false, error: error.toImportError() };
    if (error instanceof RangeError) {
      // A bounds check we did not anticipate; treat as damaged rather than crash.
      return { ok: false, error: { code: "corrupt", message: "This file is damaged and could not be read. Export the workout again, or add it manually." } };
    }
    throw error;
  }
}

export { FIT_DECODER_VERSION } from "./fit";
export { TCX_DECODER_VERSION } from "./tcx";
