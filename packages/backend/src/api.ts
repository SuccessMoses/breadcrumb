import type { SDK } from "caido:plugin";
import { RequestSpecRaw } from "caido:utils";
import type { Result } from "shared";
import { err, normalizeRaw, ok } from "shared";

const HOST_HEADER = /^host:\s*(.+)$/im;

export async function currentProjectId(
  sdk: SDK,
): Promise<Result<string | undefined>> {
  const project = await sdk.projects.getCurrent();
  return ok(project?.getId());
}

export async function sendRaw(sdk: SDK, raw: string): Promise<Result<string>> {
  const host = HOST_HEADER.exec(raw)?.[1]?.trim();
  if (host === undefined || host === "")
    return err("Request has no Host header");

  const spec = new RequestSpecRaw(`http://${host}`);
  spec.setRaw(normalizeRaw(raw));
  try {
    const { response } = await sdk.requests.send(spec);
    return ok(response.getRaw().toText());
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
