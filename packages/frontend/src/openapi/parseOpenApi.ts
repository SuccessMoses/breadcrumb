import {
  err,
  ok,
  type ParameterLocation,
  type RequestTemplate,
  type Result,
  type TemplateParameter,
} from "shared";

type Obj = Record<string, unknown>;

const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
] as const;
const PARAMETER_LOCATIONS: readonly string[] = ["path", "query", "header"];
const MAX_DEPTH = 8;

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodePointer = (segment: string) =>
  segment.replace(/~1/g, "/").replace(/~0/g, "~");

const resolveRef = (root: Obj, value: unknown): unknown => {
  let current = value;
  for (
    let depth = 0;
    depth < MAX_DEPTH && isObject(current) && typeof current.$ref === "string";
    depth++
  ) {
    const pointer = current.$ref;
    if (!pointer.startsWith("#/")) return undefined;
    current = pointer
      .slice(2)
      .split("/")
      .map(decodePointer)
      .reduce<unknown>(
        (node, key) => (isObject(node) ? node[key] : undefined),
        root,
      );
  }
  return current;
};

const exampleFrom = (
  root: Obj,
  value: unknown,
  refPath: readonly string[],
): unknown => {
  const ref =
    isObject(value) && typeof value.$ref === "string" ? value.$ref : undefined;
  if (ref !== undefined && refPath.includes(ref)) return undefined;
  const nextPath = ref === undefined ? refPath : [...refPath, ref];
  const schema = resolveRef(root, value);
  if (!isObject(schema) || nextPath.length > MAX_DEPTH) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0)
    return schema.enum[0];

  const alternatives = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(alternatives) && alternatives.length > 0) {
    return exampleFrom(root, alternatives[0], nextPath);
  }
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf
      .map((part) => exampleFrom(root, part, nextPath))
      .filter(isObject);
    return Object.assign({}, ...parts);
  }

  if (schema.type === "array")
    return [exampleFrom(root, schema.items, nextPath)];
  if (schema.type === "string") return "";
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  if (schema.type === "object" || isObject(schema.properties)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    return Object.fromEntries(
      Object.entries(properties).map(([key, property]) => [
        key,
        exampleFrom(root, property, nextPath),
      ]),
    );
  }
  return undefined;
};

const requestBody = (root: Obj, value: unknown): string | undefined => {
  const body = resolveRef(root, value);
  if (!isObject(body) || !isObject(body.content)) return undefined;
  const media = body.content["application/json"];
  if (!isObject(media)) return undefined;
  const example =
    media.example !== undefined
      ? media.example
      : exampleFrom(root, media.schema, []);
  return example === undefined ? undefined : JSON.stringify(example, null, 2);
};

const parameterList = (root: Obj, value: unknown): TemplateParameter[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parameter = resolveRef(root, entry);
    if (!isObject(parameter)) return [];
    const { name, in: location, required } = parameter;
    if (typeof name !== "string" || typeof location !== "string") return [];
    if (!PARAMETER_LOCATIONS.includes(location)) return [];
    return [
      {
        name,
        in: location as ParameterLocation,
        required: location === "path" || required === true,
      },
    ];
  });
};

const mergeParameters = (
  inherited: TemplateParameter[],
  own: TemplateParameter[],
): TemplateParameter[] => [
  ...inherited.filter(
    (item) => !own.some((o) => o.name === item.name && o.in === item.in),
  ),
  ...own,
];

const serverUrl = (root: Obj): string => {
  if (!Array.isArray(root.servers)) return "";
  const [first] = root.servers;
  return isObject(first) && typeof first.url === "string" ? first.url : "";
};

const pathTemplates = (
  root: Obj,
  baseUrl: string,
  path: string,
  item: unknown,
): RequestTemplate[] => {
  const pathItem = resolveRef(root, item);
  if (!isObject(pathItem)) return [];
  const inherited = parameterList(root, pathItem.parameters);

  return METHODS.flatMap((method) => {
    const operation = pathItem[method];
    if (!isObject(operation)) return [];
    const upper = method.toUpperCase();
    return [
      {
        id: `${upper} ${path}`,
        method: upper,
        path,
        url: `${baseUrl}${path}`,
        operationId:
          typeof operation.operationId === "string"
            ? operation.operationId
            : undefined,
        summary:
          typeof operation.summary === "string" ? operation.summary : undefined,
        parameters: mergeParameters(
          inherited,
          parameterList(root, operation.parameters),
        ),
        body: requestBody(root, operation.requestBody),
      },
    ];
  });
};

export const parseOpenApi = (text: string): Result<RequestTemplate[]> => {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return err("File is not valid JSON");
  }
  if (
    !isObject(document) ||
    typeof document.openapi !== "string" ||
    !document.openapi.startsWith("3.")
  ) {
    return err("Only OpenAPI 3.x JSON specs are supported");
  }
  const paths = document.paths;
  if (!isObject(paths)) return err("Spec has no paths");

  const baseUrl = serverUrl(document);
  return ok(
    Object.entries(paths).flatMap(([path, item]) =>
      pathTemplates(document, baseUrl, path, item),
    ),
  );
};
