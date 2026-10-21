// Parses an uploaded workout file and returns its preview. Nothing is stored:
// the bytes live only for this request.
import { assertSameOrigin, handleError, importDeps, json, readUploadForm } from "@/lib/import/server";
import { buildPreview } from "@/lib/import/service";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { bytes, fileName } = await readUploadForm(request);
    return json(await buildPreview(bytes, fileName, await importDeps()));
  } catch (error) {
    return handleError(error);
  }
}
