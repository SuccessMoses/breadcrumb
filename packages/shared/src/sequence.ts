export type SequenceStep = {
  id: string;
  templateId: string;
  request: string;
};

export type Sequence = {
  id: string;
  name: string;
  parentId: string | undefined;
  steps: SequenceStep[];
};
