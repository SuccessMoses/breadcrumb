import type { RequestTemplate } from "shared";

const METHOD_COLORS: Partial<Record<string, string>> = {
  GET: "#61affe",
  POST: "#49cc90",
  PUT: "#fca130",
  PATCH: "#50e3c2",
  DELETE: "#f93e3e",
};

export const methodColor = (method: string) =>
  METHOD_COLORS[method] ?? "#9012fe";

// The path as Swagger shows it: query parameters are left out
export const displayPath = (template: RequestTemplate) =>
  template.path.replace(/\?.*$/, "");

// The status code on the first line of a raw HTTP response, such as "403"
export const responseStatus = (
  response: string | undefined,
): string | undefined => /^HTTP\/\S+\s+(\d{3})/.exec(response ?? "")?.[1];
