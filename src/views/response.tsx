import type { AxiosResponseHeaders, RawAxiosResponseHeaders } from "axios";
import type { AxiosResponse } from "axios";
import React from "react";
import { useEffect, useState } from "react";
import { render, Text } from "ink";

type HeaderValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | undefined;

type ResponseHeaders = RawAxiosResponseHeaders | AxiosResponseHeaders;
const pendingFrames = [".", "..", "..."];
const responseSection = "--------------- Response ------------------";
const headersSection = "--------------- Headers -------------------";
const bodySection = "----------------- Body --------------------";
const errorSection = "---------------- Error --------------------";

const formatHeaderValue = (value: HeaderValue): string => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

export const formatPending = (frameIndex: number): string => {
  const frame = pendingFrames[frameIndex % pendingFrames.length];

  return `pending${frame}`;
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

  return [
    responseSection,
    "",
    statusLine,
    "",
    headersSection,
    "",
    headers,
    "",
    bodySection,
    "",
    body,
  ]
    .filter((section, index, sections) => {
      if (section !== "") {
        return true;
      }

      const previousSection = sections[index - 1];
      const nextSection = sections[index + 1];

      return previousSection !== "" && nextSection !== "";
    })
    .join("\n");
};

export const formatError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  return [errorSection, "", message].join("\n");
};

type ResponseViewProps = {
  response: AxiosResponse;
};

type ErrorViewProps = {
  error: unknown;
};

export const ResponseView = ({ response }: ResponseViewProps) => {
  return <Text>{formatResponse(response)}</Text>;
};

export const ErrorView = ({ error }: ErrorViewProps) => {
  return <Text>{formatError(error)}</Text>;
};

export const PendingView = () => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((currentFrameIndex) => currentFrameIndex + 1);
    }, 250);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return <Text>{formatPending(frameIndex)}</Text>;
};

export const displayResponse = (response: AxiosResponse) => {
  return render(<ResponseView response={response} />);
};

export const displayPending = () => {
  return render(<PendingView />);
};

export const displayError = (error: unknown) => {
  return render(<ErrorView error={error} />);
};
