export type SequenceStep = {
  id: string;
  templateId: string;
  request: string;
  response: string | undefined;
  // Values captured by this step's template, for the steps after it
  captured?: Record<string, string>;
};

export type Sequence = {
  id: string;
  name: string;
  parentId: string | undefined;
  steps: SequenceStep[];
};
