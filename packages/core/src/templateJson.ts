import type {
  ParameterLocation,
  RequestTemplate,
  TemplateAuth,
  TemplateParameter,
} from "shared";

export const TEMPLATES_FORMAT = "breadcrumb-requests";
export const TEMPLATES_VERSION = 1;

// A request as it is written to a file: its template, its request text, and the
// name of its collection (collections have no meaning outside a project)
export type TemplateItem = Omit<RequestTemplate, "id"> & {
  collection: string;
  text: string;
};

export type TemplateEntry = {
  template: RequestTemplate;
  collection: string;
  text: string;
};

export const templatesToJson = (entries: TemplateEntry[]) =>
  JSON.stringify(
    {
      format: TEMPLATES_FORMAT,
      version: TEMPLATES_VERSION,
      requests: entries.map(({ template, collection, text }) => ({
        collection,
        text,
        method: template.method,
        path: template.path,
        url: template.url,
        operationId: template.operationId,
        summary: template.summary,
        parameters: template.parameters,
        body: template.body,
        auth: template.auth,
      })),
    },
    null,
    2,
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseParameter = (value: unknown): TemplateParameter | undefined => {
  if (!isRecord(value)) return undefined;
  const { name, in: location, required } = value;
  if (typeof name !== "string" || typeof required !== "boolean") {
    return undefined;
  }
  if (location !== "path" && location !== "query" && location !== "header") {
    return undefined;
  }
  const kind: ParameterLocation = location;
  return { name, in: kind, required };
};

const parseAuth = (value: unknown): TemplateAuth | undefined =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.value === "string"
    ? { name: value.name, value: value.value }
    : undefined;

// A request without a method, path, URL or text is refused. Optional fields that
// are the wrong type are dropped, so a hand-written file still imports.
const parseItem = (value: unknown): TemplateItem | undefined => {
  if (!isRecord(value)) return undefined;
  const { method, path, url, text, collection } = value;
  if (
    typeof method !== "string" ||
    typeof path !== "string" ||
    typeof url !== "string" ||
    typeof text !== "string"
  ) {
    return undefined;
  }
  const parameters = Array.isArray(value.parameters)
    ? value.parameters.flatMap((p): TemplateParameter[] => {
        const parsed = parseParameter(p);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
  return {
    method: method.toUpperCase(),
    path,
    url,
    text,
    collection: typeof collection === "string" ? collection : "",
    operationId:
      typeof value.operationId === "string" ? value.operationId : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    body: typeof value.body === "string" ? value.body : undefined,
    auth: parseAuth(value.auth),
    parameters,
  };
};

export const parseTemplatesJson = (
  text: string,
):
  | { kind: "ok"; items: TemplateItem[] }
  | { kind: "error"; message: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "error", message: "The file is not valid JSON" };
  }
  if (!isRecord(parsed) || parsed.format !== TEMPLATES_FORMAT) {
    return {
      kind: "error",
      message: "The file is not a Breadcrumb requests file",
    };
  }
  if (!Array.isArray(parsed.requests)) {
    return { kind: "error", message: "The file has no requests list" };
  }
  const items = parsed.requests.flatMap((value): TemplateItem[] => {
    const item = parseItem(value);
    return item === undefined ? [] : [item];
  });
  if (items.length !== parsed.requests.length) {
    return {
      kind: "error",
      message: `${parsed.requests.length - items.length} request(s) are malformed`,
    };
  }
  return { kind: "ok", items };
};
