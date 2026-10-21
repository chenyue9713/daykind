// Saves a confirmed import. The browser sends the same file again with the
// user's decisions; the server re-parses it, checks the hash and decisions
// against a fresh preview, and saves all sessions in one transaction.
import { parseDecisions } from "@/lib/import/decisions";
import { assertSameOrigin, handleError, importDeps, json, readUploadForm, RequestRejected } from "@/lib/import/server";
import { confirmImport } from "@/lib/import/service";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { bytes, fileName, fields } = await readUploadForm(request);
    let decisions = null;
    try {
      decisions = parseDecisions(JSON.parse(fields.get("decisions") ?? "null"));
    } catch {
      decisions = null;
    }
    const requestId = fields.get("requestId") ?? "";
    const expectedHash = fields.get("expectedHash") ?? "";
    if (!decisions || !/^[0-9a-f]{64}$/.test(expectedHash) || requestId.length > 64) {
      throw new RequestRejected(400, { code: "invalid_decisions", message: "Your choices could not be read. Review the preview and try again." });
    }
    return json(await confirmImport(bytes, fileName, { requestId, expectedHash, decisions }, await importDeps()));
  } catch (error) {
    return handleError(error);
  }
}
