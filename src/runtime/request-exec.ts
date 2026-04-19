import axios, { type AxiosResponse } from "axios";
import type { ScopeObject } from "../compiler/semantics.ts";

export async function execute(
  scopeObject: ScopeObject,
): Promise<AxiosResponse> {
  if (!scopeObject.url) {
    throw new Error("Cannot execute request without a url.");
  }

  return axios.request({
    url: scopeObject.url,
    method: scopeObject.method,
    headers: scopeObject.headers,
    data: scopeObject.body,
    adapter: "fetch",
  });
}
