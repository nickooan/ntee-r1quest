import { ClaudeCodeAcpAdapter } from "./claude-code-adapt.ts"
import { CodexAcpAdapter } from "./codex-adapt.ts"

export {
  ClaudeCodeAcpAdapter,
  initClaudeCodeAcp,
  type ClaudeCodeAcpAdapterOptions,
  type ClaudeCodeAcpConversation,
  type ClaudeCodeAcpConversationStatus,
  type ClaudeCodeAcpPermissionDecision,
  type ClaudeCodeAcpPermissionRequest,
  type ClaudeCodeAcpResponse,
  type ClaudeCodeAcpWriteInput,
} from "./claude-code-adapt.ts"
export {
  CodexAcpAdapter,
  initCodexAcp,
  type CodexAcpAdapterOptions,
  type CodexAcpConversation,
  type CodexAcpConversationStatus,
  type CodexAcpPermissionDecision,
  type CodexAcpPermissionRequest,
  type CodexAcpResponse,
  type CodexAcpWriteInput,
} from "./codex-adapt.ts"

const acpAdaptors = {
  codex: CodexAcpAdapter,
  claude: ClaudeCodeAcpAdapter,
} as const

export type AcpAdaptorName = keyof typeof acpAdaptors
export type AcpAdaptorConstructor = (typeof acpAdaptors)[AcpAdaptorName]

export const isAdaptorName = (name: string): name is AcpAdaptorName => {
  return name in acpAdaptors
}

export const resolveAdaptorName = (name: string): AcpAdaptorName => {
  const normalizedName = name.trim().toLowerCase()

  if (isAdaptorName(normalizedName)) {
    return normalizedName
  }

  throw new Error(
    `ACP adaptor "${name}" is not supported. Supported adaptors: ${listAdaptors().join(", ")}.`,
  )
}

export const getAdaptor = (name: string): AcpAdaptorConstructor => {
  return acpAdaptors[resolveAdaptorName(name)]
}

export const listAdaptors = (): AcpAdaptorName[] => {
  return Object.keys(acpAdaptors) as AcpAdaptorName[]
}
