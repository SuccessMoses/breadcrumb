import type { DefinePluginPackageSpec } from "@caido/sdk-shared";

import type { API } from "./api";
import type { Events } from "./events";

export { type Result, ok, err } from "./result";
export type { API } from "./api";
export type { Events } from "./events";
export type {
  ParameterLocation,
  RequestTemplate,
  TemplateParameter,
} from "./template";
export type { Sequence } from "./sequence";

export type Spec = DefinePluginPackageSpec<{
  manifestId: "breadcrumb";
  api: API;
  events: Events;
}>;
