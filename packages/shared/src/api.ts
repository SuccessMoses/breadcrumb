import type { Result } from "./result";

export type API = {
  sendRaw: (raw: string) => Promise<Result<string>>;
  currentProjectId: () => Promise<Result<string | undefined>>;
};
