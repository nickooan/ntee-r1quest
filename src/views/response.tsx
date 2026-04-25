import type { AxiosResponseHeaders, RawAxiosResponseHeaders } from "axios";
import type { AxiosResponse } from "axios";
import React from "react";
import { render, Text } from "ink";

type HeaderValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | undefined;

type ResponseHeaders = RawAxiosResponseHeaders | AxiosResponseHeaders;

const formatHeaderValue = (value: HeaderValue): string => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

export const formatResponseHeaders = (headers: ResponseHeaders): string => {
  const lines = Object.entries(headers)
    .filter(([, value]) => value !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}: ${formatHeaderValue(value as HeaderValue)}`);

  return lines.join("\n");
};

export const formatResponseBody = (
  body: AxiosResponse["data"],
  contentType?: string,
): string => {
  if (typeof body === "string") {
    return body;
  }

  if (body === undefined) {
    return "";
  }

  if (
    body === null ||
    typeof body === "number" ||
    typeof body === "boolean"
  ) {
    return String(body);
  }

  if (!contentType) {
    return JSON.stringify(body, null, 2);
  }

  return JSON.stringify(body, null, 2);
};

export const formatResponse = (response: AxiosResponse): string => {
  const statusLine = `${response.status} ${response.statusText}`.trim();
  const contentType = String(response.headers["content-type"] ?? "");
  const headers = formatResponseHeaders(response.headers);
  const body = formatResponseBody(response.data, contentType);

  return [statusLine, headers, body].filter(Boolean).join("\n\n");
};

type ResponseViewProps = {
  response: AxiosResponse;
};

export const ResponseView = ({ response }: ResponseViewProps) => {
  return <Text>{formatResponse(response)}</Text>;
};

export const displayResponse = (response: AxiosResponse) => {
  return render(<ResponseView response={response} />);
};
