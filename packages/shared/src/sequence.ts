export type SequenceStep = {
  id: string;
  templateId: string;
  // The template text this step was rendered from. It is a copy, so it can be
  // edited without changing the request template. Missing in older saves, where
  // the request template's text is used.
  template?: string;
  request: string;
  response: string | undefined;
  // Values captured by this step's template, for the steps after it. Every
  // unique match, in the order they were found.
  captured?: Record<string, string[]>;
  // The value each {{name|*}} of the template was filled with for this step
  choice?: Record<string, string>;
};

export type Sequence = {
  id: string;
  name: string;
  parentId: string | undefined;
  steps: SequenceStep[];
};
