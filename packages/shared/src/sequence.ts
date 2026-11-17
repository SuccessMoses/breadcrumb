export type SequenceStep = {
  id: string;
  templateId: string;
  request: string;
  response: string | undefined;
};

export type Sequence = {
  id: string;
  name: string;
  parentId: string | undefined;
  steps: SequenceStep[];
};
