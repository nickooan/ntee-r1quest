import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import {
  compile,
  compileFile,
  CompileSourceType,
} from "../compiler/semantics.ts";
import { execute as executeRequest } from "./request.ts";

type ParsedArgs = {
  data?: string;
  executeFile?: string;
  root?: string;
};

type ConfigFile = {
  root?: string;
};

type ExecuteOptions = {
  root: string;
  source: string;
  sourceType: CompileSourceType;
};

const expandHomeDirectory = (directory: string): string => {
  if (directory === "~") {
    return homedir();
  }

  if (directory.startsWith("~/")) {
    return join(homedir(), directory.slice(2));
  }

  return directory;
};

export const readConfigRoot = (): string | null => {
  const configPaths = [
    resolve(process.cwd(), ".r1qconfig.json"),
    join(homedir(), ".ntee-r1quest", ".r1qconfig.json"),
  ];

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) {
      continue;
    }

    const config = JSON.parse(readFileSync(configPath, "utf8")) as ConfigFile;

    if (typeof config.root === "string" && config.root.length > 0) {
      return config.root;
    }
  }

  return null;
};

const parseArguments = (args: string[]): ParsedArgs => {
  const parsedArgs: ParsedArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (!argument) {
      continue;
    }

    if (argument === "-r") {
      const value = args[index + 1];

      if (!value) {
        continue;
      }

      parsedArgs.root = value;
      index += 1;
      continue;
    }

    if (argument === "-d") {
      const value = args[index + 1];

      if (!value) {
        continue;
      }

      parsedArgs.data = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("-")) {
      continue;
    }

    if (!parsedArgs.executeFile) {
      parsedArgs.executeFile = argument;
    }
  }

  return parsedArgs;
};

const resolveExecutionOptions = (parsedArgs: ParsedArgs): ExecuteOptions => {
  const baseWorkingDirectory = process.cwd();
  const configRoot = readConfigRoot();
  const inputRoot = parsedArgs.root ?? configRoot ?? baseWorkingDirectory;
  const hasExplicitRoot = parsedArgs.root !== undefined;
  const resolvedRoot = isAbsolute(inputRoot)
    ? normalize(expandHomeDirectory(inputRoot))
    : resolve(baseWorkingDirectory, expandHomeDirectory(inputRoot));

  if (parsedArgs.data) {
    return {
      root: resolvedRoot,
      source: parsedArgs.data,
      sourceType: CompileSourceType.Raw,
    };
  }

  if (!parsedArgs.executeFile) {
    throw new Error("Cannot execute request without a source file or -d data.");
  }

  const relativeExecuteFile = parsedArgs.executeFile.endsWith(".nts")
    ? parsedArgs.executeFile
    : `${parsedArgs.executeFile}.nts`;

  if (!hasExplicitRoot) {
    const resolvedExecuteFile = isAbsolute(relativeExecuteFile)
      ? normalize(expandHomeDirectory(relativeExecuteFile))
      : resolve(resolvedRoot, expandHomeDirectory(relativeExecuteFile));

    return {
      root: dirname(resolvedExecuteFile),
      source: basename(resolvedExecuteFile),
      sourceType: CompileSourceType.File,
    };
  }

  const requestFilePath = relativeExecuteFile.startsWith("/")
    ? relativeExecuteFile.slice(1)
    : relativeExecuteFile;

  return {
    root: resolvedRoot,
    source: requestFilePath,
    sourceType: CompileSourceType.File,
  };
};

const runRequest = async (options: ExecuteOptions) => {
  const previousWorkingDirectory = process.cwd();

  process.chdir(options.root);

  try {
    const scopeObject =
      options.sourceType === CompileSourceType.Raw
        ? compile(options.source, { cwd: options.root })
        : compileFile(options.source, options.sourceType);

    return await executeRequest(scopeObject);
  } finally {
    process.chdir(previousWorkingDirectory);
  }
};

export const execute = async (args: string[] = []) => {
  const parsedArgs = parseArguments(args);
  const options = resolveExecutionOptions(parsedArgs);

  return runRequest(options);
};
