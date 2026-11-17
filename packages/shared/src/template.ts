export type ParameterLocation = "path" | "query" | "header";

export type TemplateParameter = {
  name: string;
  in: ParameterLocation;
  required: boolean;
};

export type TemplateAuth = {
  name: string;
  value: string;
};

export type RequestTemplate = {
  id: string;
  method: string;
  path: string;
  url: string;
  operationId: string | undefined;
  summary: string | undefined;
  parameters: TemplateParameter[];
  body: string | undefined;
  auth: TemplateAuth | undefined;
};
