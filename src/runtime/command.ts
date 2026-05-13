import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, normalize, resolve } from "node:path"
import type { AxiosResponse } from "axios"
import { compileFile, CompileSourceType } from "../compiler/semantics.ts"
import { execute as executeRequest } from "./request.ts"

type ParsedArgs = {
  root?: string
}

type ConfigFile = {
  root?: string
}

type ExecuteOptions = {
  root: string
  source: string
}

const expandHomeDirectory = (directory: string): string => {
  if (directory === "~") {
    return homedir()
  }

  if (directory.startsWith("~/")) {
    return join(homedir(), directory.slice(2))
  }

  return directory
}

export const readConfigRoot = (): string | null => {
  const configPaths = [
    resolve(process.cwd(), ".r1qconfig.json"),
    join(homedir(), ".ntee-r1quest", ".r1qconfig.json"),
  ]

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) {
      continue
    }

    const config = JSON.parse(readFileSync(configPath, "utf8")) as ConfigFile

    if (typeof config.root === "string" && config.root.length > 0) {
      return config.root
    }
  }

  return null
}

export const parseArguments = (args: string[]): ParsedArgs => {
  const parsedArgs: ParsedArgs = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (argument !== "-r") {
      continue
    }

    const value = args[index + 1]

    if (!value) {
      continue
    }

    parsedArgs.root = value
    index += 1
  }

  return parsedArgs
}

export const resolveRoot = (args: string[] = []): string => {
  const parsedArgs = parseArguments(args)
  const baseWorkingDirectory = process.cwd()
  const configRoot = readConfigRoot()
  const inputRoot = parsedArgs.root ?? configRoot ?? baseWorkingDirectory

  return isAbsolute(inputRoot)
    ? normalize(expandHomeDirectory(inputRoot))
    : resolve(baseWorkingDirectory, expandHomeDirectory(inputRoot))
}

const normalizeSource = (source: string): string => {
  const trimmedSource = source.trim()

  if (!trimmedSource) {
    throw new Error("Cannot execute request without a source file.")
  }

  return trimmedSource.endsWith(".nts") ? trimmedSource : `${trimmedSource}.nts`
}

const runRequest = async (options: ExecuteOptions): Promise<AxiosResponse> => {
  const previousWorkingDirectory = process.cwd()

  process.chdir(options.root)

  try {
    const scopeObject = compileFile(options.source, CompileSourceType.File)

    return await executeRequest(scopeObject)
  } finally {
    process.chdir(previousWorkingDirectory)
  }
}

export const execute = async (
  source: string,
  root: string = resolveRoot(),
): Promise<AxiosResponse> => {
  return runRequest({
    root,
    source: normalizeSource(source),
  })
}
