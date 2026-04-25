import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import {
  compile,
  compileFile,
  CompileSourceType,
} from "../compiler/semantics.ts";
import { execute as executeRequest } from "./request.ts";

type ParsedArgs = {
  data?: string;
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

const parseArguments = (args: string[]): ParsedArgs => {
  const parsedArgs: ParsedArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];

    if (!argument || !value) {
      continue;
    }

    if (argument === "-r") {
      parsedArgs.root = value;
      index += 1;
      continue;
    }

    if (argument === "-d") {
      parsedArgs.data = value;
      index += 1;
    }
  }

  return parsedArgs;
};

const resolveExecutionOptions = (
  root: string | undefined,
  execteFile: string | undefined,
  parsedArgs: ParsedArgs,
): ExecuteOptions => {
  const baseWorkingDirectory = process.cwd();
  const inputRoot = parsedArgs.root ?? root ?? baseWorkingDirectory;
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

  if (!execteFile) {
    throw new Error("Cannot execute request without a source file or -d data.");
  }

  const relativeExecuteFile = execteFile.endsWith(".nts")
    ? execteFile
    : `${execteFile}.nts`;
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

export const execute = async (
  root?: string,
  execteFile?: string,
  args: string[] = [],
) => {
  const parsedArgs = parseArguments(args);
  const options = resolveExecutionOptions(root, execteFile, parsedArgs);

  return runRequest(options);
};
