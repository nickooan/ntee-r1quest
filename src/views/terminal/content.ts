import type { AxiosResponse } from "axios"
import { formatError, formatPending, formatResponse } from "../response.tsx"

export type TerminalContentOptions = {
  response?: AxiosResponse
  error?: unknown
  isPending?: boolean
  frameIndex: number
}

export const formatTerminalContent = ({
  response,
  error,
  isPending,
  frameIndex,
}: TerminalContentOptions): string => {
  if (isPending) {
    return formatPending(frameIndex)
  }

  if (error !== undefined) {
    return formatError(error)
  }

  if (response) {
    return formatResponse(response)
  }

  return ""
}
