import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, normalize, resolve } from "node:path"
import YAML from "yaml"

export type ParsedArgs = {
  root?: string
  ai?: string
  path?: string
}

type ConfigFile = {
  root?: string | null
  ai?: string | null
  sock?: string | null
  "custom-suggestions"?: string[] | null
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
  customSuggestions: string[]
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

const configFileNames = [".r1qconfig.yaml", ".r1qconfig.yml"] as const

const configPathsForDirectory = (directory: string): string[] => {
  return configFileNames.map((fileName) => resolve(directory, fileName))
}

const configPaths = (): string[] => [
  ...configPathsForDirectory(process.cwd()),
  ...configPathsForDirectory(join(homedir(), ".ntee-r1quest")),
]

const readConfigSource = (configPath: string): ConfigSource | null => {
  if (!existsSync(configPath)) {
    return null
  }

  return {
    path: configPath,
    directory: dirname(configPath),
    config: (YAML.parse(readFileSync(configPath, "utf8")) ?? {}) as ConfigFile,
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

const findConfigValues = (
  sources: ConfigSource[],
  key: keyof ConfigFile,
): string[] => {
  const values = new Set<string>()

  for (const source of sources) {
    const sourceValues = source.config[key]

    if (!Array.isArray(sourceValues)) {
      continue
    }

    for (const value of sourceValues) {
      if (typeof value === "string" && value.length > 0) {
        values.add(value)
      }
    }
  }

  return [...values]
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
  const rootSources = readConfigSources(
    configPathsForDirectory(root).filter(
      (configPath) => !baseSources.some((source) => source.path === configPath),
    ),
  )
  const sources = [...rootSources, ...baseSources]
  const inputAi = parsedArgs.ai ?? findConfigValue(sources, "ai")?.value
  const inputSock = findConfigValue(sources, "sock")
  const customSuggestions = findConfigValues(sources, "custom-suggestions")

  return {
    root,
    ai: inputAi,
    sock: inputSock
      ? resolvePathFrom(inputSock.source.directory, inputSock.value)
      : undefined,
    customSuggestions,
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
