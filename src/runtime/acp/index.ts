import { CodexAcpAdapter } from "./codex-adapt.ts"

export {
  CodexAcpAdapter,
  initCodexAcp,
  type CodexAcpAdapterOptions,
  type CodexAcpPermissionDecision,
  type CodexAcpPermissionRequest,
  type CodexAcpResponse,
  type CodexAcpWriteInput,
} from "./codex-adapt.ts"

const acpAdaptors = {
  codex: CodexAcpAdapter,
} as const

export type AcpAdaptorName = keyof typeof acpAdaptors
export type AcpAdaptorConstructor = (typeof acpAdaptors)[AcpAdaptorName]

export const getAdaptor = (name: AcpAdaptorName): AcpAdaptorConstructor => {
  return acpAdaptors[name]
}

export const listAdaptors = (): AcpAdaptorName[] => {
  return Object.keys(acpAdaptors) as AcpAdaptorName[]
}
