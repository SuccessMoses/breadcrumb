import { sendRaw } from "./api";
import type { BackendSDK } from "./types";

export function init(sdk: BackendSDK) {
  sdk.api.register("sendRaw", sendRaw);
}
