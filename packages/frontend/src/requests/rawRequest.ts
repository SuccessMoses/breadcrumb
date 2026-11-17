import type { RequestTemplate } from "shared";

const LINE_BREAK = "\r\n";
const ABSOLUTE_URL = /^https?:\/\/([^/]+)(.*)$/;

export const buildRawRequest = (template: RequestTemplate): string => {
  const absolute = ABSOLUTE_URL.exec(template.url);
  const host = absolute?.[1] ?? "<host>";
  const pathname = absolute?.[2] ?? template.url;

  const query = template.parameters
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => `${parameter.name}=<${parameter.name}>`);
  const target = query.length > 0 ? `${pathname}?${query.join("&")}` : pathname;

  const headers = [
    `Host: ${host}`,
    ...template.parameters
      .filter((parameter) => parameter.in === "header")
      .map((parameter) => `${parameter.name}: <${parameter.name}>`),
    ...(template.auth === undefined
      ? []
      : [`${template.auth.name}: ${template.auth.value}`]),
    ...(template.body === undefined ? [] : ["Content-Type: application/json"]),
  ];

  const head = [`${template.method} ${target} HTTP/1.1`, ...headers].join(
    LINE_BREAK,
  );
  return template.body === undefined
    ? `${head}${LINE_BREAK}${LINE_BREAK}`
    : `${head}${LINE_BREAK}${LINE_BREAK}${template.body}`;
};
