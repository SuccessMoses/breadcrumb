import type { RequestTemplate } from "shared";

import { stripNotes } from "./notes";

const LINE_BREAK = "\r\n";
const ABSOLUTE_URL = /^https?:\/\/([^/]+)(.*)$/;
const RANDOM_TOKEN = /\{random\}/g;
const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const RANDOM_LENGTH = 10;

const randomString = () =>
  Array.from(
    { length: RANDOM_LENGTH },
    () =>
      RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)] ?? "",
  ).join("");

// The request a template starts with: method, URL, headers and JSON body, with
// <name> placeholders left for you to fill in.
export const defaultRequest = (template: RequestTemplate): string => {
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
  const body =
    template.body === undefined
      ? ""
      : JSON.stringify(JSON.parse(template.body), null, 2);
  return `${head}${LINE_BREAK}${LINE_BREAK}${body}`;
};

// Turns template text into one request. Each {random} gets its own random
// string, so every sequence the template is rendered into gets different values.
export const expandTemplate = (text: string): string =>
  stripNotes(text)
    .replace(/\r?\n/g, LINE_BREAK)
    .replace(RANDOM_TOKEN, () => randomString());
