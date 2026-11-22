import type { DefinePluginPackageSpec } from "@caido/sdk-shared";

import type { API } from "./api";
import type { Events } from "./events";

export { type Result, ok, err } from "./result";
export { normalizeRaw } from "./raw";
export {
  encodeBase64,
  requestBytes,
  UPLOAD_END,
  UPLOAD_LIMIT_BYTES,
  UPLOAD_START,
} from "./upload";
export type { API } from "./api";
export type { Events } from "./events";
export type {
  ParameterLocation,
  RequestTemplate,
  TemplateAuth,
  TemplateParameter,
} from "./template";
export type { Sequence, SequenceStep } from "./sequence";

export type Spec = DefinePluginPackageSpec<{
  manifestId: "breadcrumb";
  api: API;
  events: Events;
}>;
