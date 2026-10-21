// Content detection. The extension only says which formats are acceptable;
// the bytes decide what the file actually is (PRD FR04).
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "./limits";
import { ImportFailure, type WorkoutFormat } from "./types";

const MANUAL_ENTRY_HINT = "You can add this workout manually in the evening check-in instead.";

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

const ARCHIVES: { name: string; signature: number[] }[] = [
  { name: "ZIP", signature: [0x50, 0x4b, 0x03, 0x04] },
  { name: "ZIP", signature: [0x50, 0x4b, 0x05, 0x06] },
  { name: "gzip", signature: [0x1f, 0x8b] },
  { name: "7-Zip", signature: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { name: "RAR", signature: ascii("Rar!") },
  { name: "bzip2", signature: ascii("BZh") },
  { name: "xz", signature: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
];

const OTHER_KNOWN: { name: string; signature: number[] }[] = [
  { name: "PDF", signature: ascii("%PDF") },
  { name: "PNG image", signature: [0x89, 0x50, 0x4e, 0x47] },
  { name: "JPEG image", signature: [0xff, 0xd8, 0xff] },
  { name: "GIF image", signature: ascii("GIF8") },
  { name: "photo or video", signature: ascii("ftyp") },
];

export function extensionOf(fileName: string | null): string | null {
  const match = fileName ? /\.([A-Za-z0-9]{1,8})$/.exec(fileName) : null;
  return match ? match[1].toLowerCase() : null;
}

/** Makes an untrusted filename safe to store and display: base name only, printable, short. */
export function sanitizeFileName(fileName: string | null): string | null {
  if (!fileName) return null;
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "").trim();
  if (!cleaned) return null;
  return cleaned.length > 120 ? `${cleaned.slice(0, 100)}…${cleaned.slice(-12)}` : cleaned;
}

export function isFitHeader(bytes: Uint8Array): boolean {
  return (bytes[0] === 12 || bytes[0] === 14) && startsWith(bytes, ascii(".FIT"), 8);
}

function looksLikeXml(bytes: Uint8Array): boolean {
  let i = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < bytes.length && i < 4096 && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return bytes[i] === 0x3c; // "<"
}

/** Checks size, extension, and magic bytes. Throws an actionable ImportFailure. */
export function detectFormat(bytes: Uint8Array, fileName: string | null): WorkoutFormat {
  if (bytes.length === 0) {
    throw new ImportFailure("empty", "This file is empty. Export the workout again and select the new file.");
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ImportFailure("too_large", `This file is larger than ${MAX_FILE_LABEL}. Export a single workout instead.`);
  }

  const ext = extensionOf(fileName);
  const archive = ARCHIVES.find((a) => startsWith(bytes, a.signature));
  if (archive) {
    throw new ImportFailure(
      "archive",
      `This is a ${archive.name} archive, not a workout file. Garmin's “Export Original” downloads a .zip: open it (on a phone, tap it in Files) and select the .fit file inside.`,
    );
  }
  if (ext !== "tcx" && ext !== "fit") {
    throw new ImportFailure("wrong_extension", `Select a .fit or .tcx file. ${MANUAL_ENTRY_HINT}`);
  }

  if (isFitHeader(bytes)) return "fit";
  if (looksLikeXml(bytes)) return "tcx";

  const other = OTHER_KNOWN.find((k) => startsWith(bytes, k.signature, k.name === "photo or video" ? 4 : 0));
  throw new ImportFailure(
    "unsupported_content",
    `${other ? `This is a ${other.name}` : "This file's contents are not a FIT or TCX workout"}, even though it is named .${ext}. ${MANUAL_ENTRY_HINT}`,
  );
}
