import axios, { type AxiosResponse } from "axios";
import type { ScopeObject } from "../compiler/semantics.ts";

export const execute = async (
  scopeObject: ScopeObject,
): Promise<AxiosResponse> => {
  const contentType = String(scopeObject.headers["content-type"] ?? "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    return handleFormRequest(scopeObject);
  }

  if (contentType.includes("application/json")) {
    return handleJSONRequest(scopeObject);
  }

  throw new Error(`Unsupported content type: ${contentType || "missing"}.`);
};

export const handleJSONRequest = async (
  scopeObject: ScopeObject,
): Promise<AxiosResponse> => {
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
};

export const handleFormRequest = async (
  scopeObject: ScopeObject,
): Promise<AxiosResponse> => {
  if (!scopeObject.url) {
    throw new Error("Cannot execute request without a url.");
  }

  const formData = new FormData();

  for (const [key, value] of Object.entries(scopeObject.body ?? {})) {
    formData.append(key, toFormValue(value));
  }

  const { body, contentType } = await encodeFormData(formData);

  return axios.request({
    url: scopeObject.url,
    method: scopeObject.method,
    headers: {
      ...scopeObject.headers,
      "content-type": contentType,
    },
    data: body,
    adapter: "fetch",
  });
};

const toFormValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
};

const encodeFormData = async (
  formData: FormData,
): Promise<{ body: Blob; contentType: string }> => {
  const request = new Request("https://ntee.local", {
    method: "POST",
    body: formData,
  });
  const contentType = request.headers.get("content-type");

  if (!contentType) {
    throw new Error("Cannot encode multipart form data.");
  }

  return {
    body: await request.blob(),
    contentType,
  };
};
