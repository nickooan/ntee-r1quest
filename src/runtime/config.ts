import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, normalize, resolve } from "node:path"

export type ParsedArgs = {
  root?: string
  ai?: string
  path?: string
}

type ConfigFile = {
  root?: string | null
  ai?: string | null
  sock?: string | null
}

type ConfigSource = {
  path: string
  directory: string
  config: ConfigFile
}

export type RuntimeConfig = {
  root: string
  ai?: string
  sock?: string
  parsedArgs: ParsedArgs
}

const argumentNames = ["-r", "-ai", "-p"] as const
type ArgumentName = (typeof argumentNames)[number]

const argumentKeys: Record<ArgumentName, keyof ParsedArgs> = {
  "-r": "root",
  "-ai": "ai",
  "-p": "path",
}

let cachedConfig: RuntimeConfig | undefined
let cachedConfigKey: string | undefined

const expandHomeDirectory = (directory: string): string => {
  if (directory === "~") {
    return homedir()
  }

  if (directory.startsWith("~/")) {
    return join(homedir(), directory.slice(2))
  }

  return directory
}

const resolvePathFrom = (baseDirectory: string, inputPath: string): string => {
  const expandedPath = expandHomeDirectory(inputPath)

  return isAbsolute(expandedPath)
    ? normalize(expandedPath)
    : resolve(baseDirectory, expandedPath)
}

const configPaths = (): string[] => [
  resolve(process.cwd(), ".r1qconfig.json"),
  join(homedir(), ".ntee-r1quest", ".r1qconfig.json"),
]

const readConfigSource = (configPath: string): ConfigSource | null => {
  if (!existsSync(configPath)) {
    return null
  }

  return {
    path: configPath,
    directory: dirname(configPath),
    config: JSON.parse(readFileSync(configPath, "utf8")) as ConfigFile,
  }
}

const readConfigSources = (paths: string[]): ConfigSource[] => {
  return paths
    .map((configPath) => readConfigSource(configPath))
    .filter((source): source is ConfigSource => source !== null)
}

const isArgumentName = (argument: string): argument is ArgumentName => {
  return argumentNames.includes(argument as ArgumentName)
}

export const parseArguments = (args: string[]): ParsedArgs => {
  const parsedArgs: ParsedArgs = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (!argument || !isArgumentName(argument)) {
      continue
    }

    const value = args[index + 1]

    if (!value) {
      continue
    }

    parsedArgs[argumentKeys[argument]] = value
    index += 1
  }

  return parsedArgs
}

const findConfigValue = (
  sources: ConfigSource[],
  key: keyof ConfigFile,
): { value: string; source: ConfigSource } | undefined => {
  for (const source of sources) {
    const value = source.config[key]

    if (typeof value === "string" && value.length > 0) {
      return {
        value,
        source,
      }
    }
  }

  return undefined
}

export const loadRuntimeConfig = (args: string[] = []): RuntimeConfig => {
  const parsedArgs = parseArguments(args)
  const baseWorkingDirectory = process.cwd()
  const baseSources = readConfigSources(configPaths())
  const configRoot = findConfigValue(baseSources, "root")
  const inputRoot = parsedArgs.root ?? configRoot?.value ?? baseWorkingDirectory
  const rootBaseDirectory = parsedArgs.root
    ? baseWorkingDirectory
    : (configRoot?.source.directory ?? baseWorkingDirectory)
  const root = resolvePathFrom(rootBaseDirectory, inputRoot)
  const rootConfigPath = resolve(root, ".r1qconfig.json")
  const rootSource = baseSources.some(
    (source) => source.path === rootConfigPath,
  )
    ? null
    : readConfigSource(rootConfigPath)
  const sources = rootSource ? [rootSource, ...baseSources] : baseSources
  const inputAi = parsedArgs.ai ?? findConfigValue(sources, "ai")?.value
  const inputSock = findConfigValue(sources, "sock")

  return {
    root,
    ai: inputAi,
    sock: inputSock
      ? resolvePathFrom(inputSock.source.directory, inputSock.value)
      : undefined,
    parsedArgs,
  }
}

export const initializeRuntimeConfig = (args: string[] = []): RuntimeConfig => {
  const cacheKey = JSON.stringify({
    cwd: process.cwd(),
    args,
  })

  if (cachedConfig && cachedConfigKey === cacheKey) {
    return cachedConfig
  }

  cachedConfig = loadRuntimeConfig(args)
  cachedConfigKey = cacheKey

  return cachedConfig
}

export const getRuntimeConfig = (): RuntimeConfig => {
  return cachedConfig ?? initializeRuntimeConfig()
}

export const clearRuntimeConfigCache = (): void => {
  cachedConfig = undefined
  cachedConfigKey = undefined
}
