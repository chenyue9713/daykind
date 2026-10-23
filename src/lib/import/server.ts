import "server-only";

// HTTP glue for the import route handlers: same-origin check, a byte-capped
// body reader (the 20 MB limit is enforced while streaming, before parsing),
// multipart extraction, and the user-scoped repository from the shared contract.
import { unstable_rethrow } from "next/navigation";

import { getRepository, isSetUp } from "@/lib/data";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "./limits";
import type { ImportDeps } from "./service";
import type { ImportError } from "./types";

/** Room for multipart boundaries, part headers, and the small decision fields. */
const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

export class RequestRejected extends Error {
  constructor(
    readonly status: number,
    readonly error: ImportError,
  ) {
    super(error.message);
  }
}

const tooLarge = () =>
  new RequestRejected(413, { code: "too_large", message: `This file is larger than ${MAX_FILE_LABEL}. Export a single workout instead.` });

/** Rejects cross-site requests. Route handlers do not get the Server Action origin check. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost && host && originHost === host) return;
  } else if (request.headers.get("sec-fetch-site") === "same-origin") {
    return;
  }
  throw new RequestRejected(403, { code: "unsupported_content", message: "This request did not come from DayKind." });
}

async function readCapped(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export interface UploadForm {
  bytes: Uint8Array;
  fileName: string | null;
  fields: Map<string, string>;
}

/** Reads a multipart form with one `file` part and small text fields, within the size limit. */
export async function readUploadForm(request: Request): Promise<UploadForm> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new RequestRejected(415, { code: "unsupported_content", message: "Send the workout file as a form upload." });
  }
  const body = await readCapped(request, MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES);
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new RequestRejected(400, { code: "corrupt", message: "The upload was interrupted or malformed. Select the file again." });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    throw new RequestRejected(400, { code: "empty", message: "Select a .fit or .tcx file to import." });
  }
  if (file.size > MAX_FILE_BYTES) throw tooLarge();
  const fields = new Map<string, string>();
  for (const [key, value] of form.entries()) {
    if (key !== "file" && typeof value === "string" && value.length <= 64 * 1024) fields.set(key, value);
  }
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: "name" in file && typeof file.name === "string" ? file.name : null,
    fields,
  };
}

/** The signed-in user's store and timezone (shared contract: getRepository() is user-scoped). */
export async function importDeps(): Promise<ImportDeps> {
  const repo = await getRepository();
  if (!(await isSetUp(repo))) {
    throw new RequestRejected(409, {
      code: "conflict",
      message: "Finish setting up DayKind (timezone and units) before importing. Nothing was saved.",
    });
  }
  const profile = await repo.getProfile();
  return { store: repo, profileTimezone: profile.timezone };
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Turns anything thrown in a handler into an actionable JSON error, letting Next.js redirects through. */
export function handleError(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof RequestRejected) return json({ ok: false, status: "error", error: error.error }, error.status);
  // Never echo internals or file contents.
  console.error("workout import failed", error instanceof Error ? error.name : typeof error);
  return json(
    { ok: false, status: "error", error: { code: "storage_failed", message: "Something went wrong on the server, and nothing was saved. Try again." } },
    500,
  );
}
