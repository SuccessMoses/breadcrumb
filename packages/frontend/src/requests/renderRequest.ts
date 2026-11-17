import type { RequestTemplate } from "shared";

type Obj = Record<string, unknown>;

const LINE_BREAK = "\r\n";
const ABSOLUTE_URL = /^https?:\/\/([^/]+)(.*)$/;
const CHOICE_SEPARATOR = /(?<!\\),/;
const RANDOM_TOKEN = /\{random\}/g;
const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const RANDOM_LENGTH = 10;

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const randomString = () =>
  Array.from(
    { length: RANDOM_LENGTH },
    () =>
      RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)] ?? "",
  ).join("");

const expandPayload = (value: string) => {
  const choices = value
    .split(CHOICE_SEPARATOR)
    .map((choice) => choice.replace(/\\,/g, ","));
  const chosen = choices[Math.floor(Math.random() * choices.length)] ?? "";
  return chosen.replace(RANDOM_TOKEN, () => randomString());
};

const flattenJson = (value: unknown, prefix: string): [string, unknown][] =>
  isObject(value) && Object.keys(value).length > 0
    ? Object.entries(value).flatMap(([key, child]) =>
        flattenJson(child, prefix === "" ? key : `${prefix}.${key}`),
      )
    : [[prefix, value]];

const setPath = (node: Obj, keys: string[], value: unknown): void => {
  const [key, ...rest] = keys;
  if (key === undefined) return;
  if (rest.length === 0) {
    node[key] = value;
    return;
  }
  const existing = node[key];
  const child: Obj = isObject(existing) ? existing : {};
  node[key] = child;
  setPath(child, rest, value);
};

const renderBody = (
  body: string | undefined,
  override: (key: string) => string | undefined,
) => {
  if (body === undefined) return undefined;
  const parsed: unknown = JSON.parse(body);
  if (!isObject(parsed)) return body;
  for (const [path] of flattenJson(parsed, "")) {
    const value = override(path);
    if (value !== undefined) setPath(parsed, path.split("."), value);
  }
  return JSON.stringify(parsed, null, 2);
};

export const payloadFields = (
  template: RequestTemplate,
): { key: string; defaultText: string }[] => {
  const parameterFields = template.parameters.map((parameter) => ({
    key: parameter.name,
    defaultText:
      parameter.in === "path" ? `{${parameter.name}}` : `<${parameter.name}>`,
  }));
  const authFields =
    template.auth === undefined
      ? []
      : [{ key: template.auth.name, defaultText: template.auth.value }];
  const bodyFields =
    template.body === undefined
      ? []
      : flattenJson(JSON.parse(template.body), "").map(([key, value]) => ({
          key,
          defaultText: JSON.stringify(value),
        }));
  const fields = [...parameterFields, ...authFields, ...bodyFields];
  return [...new Map(fields.map((field) => [field.key, field])).values()];
};

export const renderRequest = (
  template: RequestTemplate,
  payloads: Record<string, string | undefined>,
): string => {
  const override = (key: string) => {
    const value = payloads[key];
    return value === undefined || value === ""
      ? undefined
      : expandPayload(value);
  };

  const absolute = ABSOLUTE_URL.exec(template.url);
  const host = absolute?.[1] ?? "<host>";
  let pathname = absolute?.[2] ?? template.url;
  for (const parameter of template.parameters) {
    if (parameter.in !== "path") continue;
    const value = override(parameter.name);
    if (value !== undefined) {
      pathname = pathname.replaceAll(
        `{${parameter.name}}`,
        encodeURIComponent(value),
      );
    }
  }

  const query = template.parameters
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => {
      const value = override(parameter.name);
      return `${parameter.name}=${value === undefined ? `<${parameter.name}>` : encodeURIComponent(value)}`;
    });
  const target = query.length > 0 ? `${pathname}?${query.join("&")}` : pathname;

  const headers = [
    `Host: ${host}`,
    ...template.parameters
      .filter((parameter) => parameter.in === "header")
      .map(
        (parameter) =>
          `${parameter.name}: ${override(parameter.name) ?? `<${parameter.name}>`}`,
      ),
    ...(template.auth === undefined
      ? []
      : [
          `${template.auth.name}: ${override(template.auth.name) ?? template.auth.value}`,
        ]),
    ...(template.body === undefined ? [] : ["Content-Type: application/json"]),
  ];

  const body = renderBody(template.body, override);
  const head = [`${template.method} ${target} HTTP/1.1`, ...headers].join(
    LINE_BREAK,
  );
  return body === undefined
    ? `${head}${LINE_BREAK}${LINE_BREAK}`
    : `${head}${LINE_BREAK}${LINE_BREAK}${body}`;
};
