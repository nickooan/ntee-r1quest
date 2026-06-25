import { formatError, formatPending, formatResponse } from "../response.tsx"
import type { ExecuteResult } from "../../runtime/client/types.ts"

export type TerminalContentOptions = {
  response?: ExecuteResult
  error?: unknown
  externalContent?: string
  isPending?: boolean
  frameIndex: number
  // Result pane content width, used to size the response/error section rules.
  width?: number
}

export const formatTerminalContent = ({
  response,
  error,
  externalContent,
  isPending,
  frameIndex,
  width,
}: TerminalContentOptions): string => {
  if (isPending) {
    return formatPending(frameIndex)
  }

  if (error !== undefined) {
    return formatError(error, undefined, width)
  }

  if (externalContent !== undefined) {
    return externalContent
  }

  if (response) {
    return formatResponse(response, undefined, width)
  }

  return ""
}
