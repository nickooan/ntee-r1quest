import axios, { type AxiosResponse } from "axios";
import type { ScopeObject } from "../compiler/semantics.ts";

export const execute = async (
  scopeObject: ScopeObject,
): Promise<AxiosResponse> => {
  const contentType = String(
    scopeObject.headers["content-type"] ?? "",
  ).toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    return handleFormRequest(scopeObject);
  }

  if (contentType.includes("application/json")) {
    return handleJSONRequest(scopeObject);
  }

  if (contentType.includes("text/plain")) {
    return handleTextRequest(scopeObject);
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

  if (!scopeObject.method) {
    throw new Error("Cannot execute request without a method.");
  }

  const formData = new FormData();
  const requestBody = scopeObject.body;

  if (
    typeof requestBody !== "object" ||
    requestBody === null ||
    Array.isArray(requestBody)
  ) {
    throw new Error("Form request body must be an object.");
  }

  for (const [key, value] of Object.entries(requestBody)) {
    formData.append(key, toFormValue(value));
  }

  const { "content-type": _contentType, ...headers } = scopeObject.headers;
  const multipartRequest = new Request(scopeObject.url, {
    method: scopeObject.method.toUpperCase(),
    body: formData,
  });
  const contentType = multipartRequest.headers.get("content-type");

  if (!contentType || !multipartRequest.body) {
    throw new Error("Cannot encode multipart form data.");
  }

  return axios.request({
    url: scopeObject.url,
    method: scopeObject.method,
    headers: {
      ...headers,
      /**
       * Replace "multipart/form-data" with the generated value, for example
       * "multipart/form-data; boundary=----WebKitFormBoundary...", so the
       * header boundary matches multipartRequest.body.
       */
      "content-type": contentType,
    },
    data: multipartRequest.body,
    adapter: "fetch",
  });
};

export const handleTextRequest = async (
  scopeObject: ScopeObject,
): Promise<AxiosResponse> => {
  if (!scopeObject.url) {
    throw new Error("Cannot execute request without a url.");
  }

  if (typeof scopeObject.body !== "string") {
    throw new Error("Text request body must be a string.");
  }

  return axios.request({
    url: scopeObject.url,
    method: scopeObject.method,
    headers: scopeObject.headers,
    data: scopeObject.body,
    adapter: "fetch",
  });
};

const toFormValue = (value: unknown): string | Blob => {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Blob) {
    return value;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
};
