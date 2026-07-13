import axios, { type AxiosResponse } from "axios"
import {
  isJointScope,
  type CompileResult,
  type ScopeObject,
} from "../compiler/semantics.ts"

export const execute = async (
  compileResult: CompileResult,
): Promise<AxiosResponse> => {
  if (isJointScope(compileResult)) {
    throw new Error(
      "Cannot execute a joint scope as a single request — run it as a chain.",
    )
  }

  const scopeObject = compileResult
  const contentType = String(
    scopeObject.headers["content-type"] ?? "",
  ).toLowerCase()

  if (contentType.includes("multipart/form-data")) {
    return handleFormRequest(scopeObject)
  }

  assertNoFileBody(scopeObject)

  if (contentType.includes("application/json")) {
    return handleJSONRequest(scopeObject)
  }

  if (contentType.startsWith("text/")) {
    return handleTextRequest(scopeObject)
  }

  throw new Error(`Unsupported content type: ${contentType || "missing"}.`)
}

export const handleJSONRequest = async (
  scopeObject: ScopeObject,
): Promise<AxiosResponse> => {
  if (!scopeObject.url) {
    throw new Error("Cannot execute request without a url.")
  }

  assertNoFileBody(scopeObject)

  return axios.request({
    url: scopeObject.url,
    method: scopeObject.method,
    headers: scopeObject.headers,
    data: scopeObject.body,
    adapter: "fetch",
  })
}

export const handleFormRequest = async (
  scopeObject: ScopeObject,
): Promise<AxiosResponse> => {
  if (!scopeObject.url) {
    throw new Error("Cannot execute request without a url.")
  }

  if (!scopeObject.method) {
    throw new Error("Cannot execute request without a method.")
  }

  const formData = new FormData()
  const requestBody = scopeObject.body

  if (
    typeof requestBody !== "object" ||
    requestBody === null ||
    Array.isArray(requestBody)
  ) {
    throw new Error("Form request body must be an object.")
  }

  for (const [key, value] of Object.entries(requestBody)) {
    appendFormValue(formData, key, value)
  }

  const { "content-type": _contentType, ...headers } = scopeObject.headers
  const multipartRequest = new Request(scopeObject.url, {
    method: scopeObject.method.toUpperCase(),
    body: formData,
  })
  const contentType = multipartRequest.headers.get("content-type")

  if (!contentType || !multipartRequest.body) {
    throw new Error("Cannot encode multipart form data.")
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
  })
}

export const handleTextRequest = async (
  scopeObject: ScopeObject,
): Promise<AxiosResponse> => {
  if (!scopeObject.url) {
    throw new Error("Cannot execute request without a url.")
  }

  assertNoFileBody(scopeObject)

  const canOmitBody =
    scopeObject.method?.toLowerCase() === "get" &&
    (scopeObject.body === null || scopeObject.body === undefined)

  if (!canOmitBody && typeof scopeObject.body !== "string") {
    throw new Error("Text request body must be a string.")
  }

  return axios.request({
    url: scopeObject.url,
    method: scopeObject.method,
    headers: scopeObject.headers,
    data: scopeObject.body,
    adapter: "fetch",
  })
}

const assertNoFileBody = (scopeObject: ScopeObject): void => {
  if (containsFileValue(scopeObject.body)) {
    throw new Error(
      "File body values are only supported with multipart/form-data requests.",
    )
  }
}

const containsFileValue = (value: unknown): boolean => {
  if (value instanceof Blob) {
    return true
  }

  if (Array.isArray(value)) {
    return value.some(containsFileValue)
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(containsFileValue)
  }

  return false
}

const appendFormValue = (
  formData: FormData,
  key: string,
  value: unknown,
): void => {
  if (Array.isArray(value) && value.some(containsFileValue)) {
    for (const item of value) {
      formData.append(key, toFormValue(item))
    }

    return
  }

  formData.append(key, toFormValue(value))
}

const toFormValue = (value: unknown): string | Blob => {
  if (value === null || value === undefined) {
    return ""
  }

  if (value instanceof Blob) {
    return value
  }

  if (typeof value === "object") {
    return JSON.stringify(value)
  }

  return String(value)
}
