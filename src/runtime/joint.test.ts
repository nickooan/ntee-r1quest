import { describe, expect, jest, test } from "@jest/globals"
import type { AxiosResponse } from "axios"
import type { CompileResult, JointScopeObject } from "../compiler/semantics.ts"
import {
  evaluateJsonPath,
  isJointStepError,
  runJointChain,
  JointStepError,
  type JointStepResult,
} from "./joint.ts"

const jsonResponse = (data: unknown, status = 200): AxiosResponse =>
  ({
    data,
    status,
    statusText: "OK",
    headers: { "content-type": "application/json; charset=utf-8" },
    config: {},
  }) as AxiosResponse

const requestScope = (contentType = "application/json"): CompileResult => ({
  url: "https://ntee.io",
  method: "get",
  headers: { "content-type": contentType },
})

const jointScope = (
  steps: JointScopeObject["steps"],
  traceId?: string,
): JointScopeObject => ({
  kind: "joint",
  ...(traceId ? { traceId } : {}),
  steps,
})

describe("evaluateJsonPath", () => {
  test("resolves nested keys, array indexes and hyphenated keys", () => {
    const data = {
      userId: 7,
      data: [{ postId: "p-1" }, { postId: "p-2" }],
      post: { user: { role: "admin" } },
      "content-type": "application/json",
    }

    expect(evaluateJsonPath(data, "userId")).toBe(7)
    expect(evaluateJsonPath(data, "data[0].postId")).toBe("p-1")
    expect(evaluateJsonPath(data, "data[1].postId")).toBe("p-2")
    expect(evaluateJsonPath(data, "post.user.role")).toBe("admin")
    expect(evaluateJsonPath(data, "content-type")).toBe("application/json")
  })

  test("throws a ReferenceError naming the missing segment", () => {
    expect(() => evaluateJsonPath({ a: { b: 1 } }, "a.c")).toThrow(
      ReferenceError,
    )
    expect(() => evaluateJsonPath({ a: { b: 1 } }, "a.c")).toThrow(
      'Cannot resolve json path "a.c": "c" is missing',
    )
    expect(() => evaluateJsonPath({ a: [] }, "a[3].b")).toThrow(ReferenceError)
  })

  test("throws when traversing through a non-object value", () => {
    expect(() => evaluateJsonPath({ a: "text" }, "a.b")).toThrow(
      '"b" is not reachable',
    )
    expect(() => evaluateJsonPath(null, "a")).toThrow(ReferenceError)
  })
})

describe("runJointChain", () => {
  test("runs steps in order, accumulating picked env across steps", async () => {
    const calls: Array<{ source: string; traceId: string; env: string }> = []
    const responses = [
      jsonResponse({ userId: 7 }),
      jsonResponse({ data: [{ postId: "p-9" }] }),
      jsonResponse({ ok: true }),
    ]

    const result = await runJointChain({
      root: "/root",
      jointPath: "/root/queries/chain.joint.nts",
      joint: jointScope(
        [
          {
            pick: { content: { kind: "value", value: "application/json" } },
            run: "query-user",
          },
          {
            pick: { userId: { kind: "jsonPath", path: "userId" } },
            run: "query-user-posts",
          },
          {
            pick: { postId: { kind: "jsonPath", path: "data[0].postId" } },
            run: "../query-post-comments",
          },
        ],
        "trace-1",
      ),
      runStep: async (options) => {
        calls.push({
          source: options.source,
          traceId: options.traceId,
          env: options.env,
        })
        options.validateScope(requestScope())
        return responses[calls.length - 1]!
      },
    })

    expect(calls).toEqual([
      {
        source: "/root/queries/query-user.nts",
        traceId: "trace-1",
        env: JSON.stringify({ content: "application/json" }),
      },
      {
        source: "/root/queries/query-user-posts.nts",
        traceId: "trace-1",
        env: JSON.stringify({ content: "application/json", userId: "7" }),
      },
      {
        source: "/root/query-post-comments.nts",
        traceId: "trace-1",
        env: JSON.stringify({
          content: "application/json",
          userId: "7",
          postId: "p-9",
        }),
      },
    ])
    expect(result.traceId).toBe("trace-1")
    expect(result.stepCount).toBe(3)
    expect(result.response.data).toEqual({ ok: true })
  })

  test("seeds the chain env from -env and lets later picks override", async () => {
    const envs: string[] = []

    await runJointChain({
      root: "/root",
      jointPath: "/root/chain.joint.nts",
      joint: jointScope([
        { run: "first" },
        {
          pick: { token: { kind: "jsonPath", path: "token" } },
          run: "second",
        },
      ]),
      cliEnv: '{"token": "from-cli", "keep": "kept"}',
      runStep: async (options) => {
        envs.push(options.env)
        return jsonResponse({ token: "from-response" })
      },
    })

    expect(envs).toEqual([
      JSON.stringify({ token: "from-cli", keep: "kept" }),
      JSON.stringify({ token: "from-response", keep: "kept" }),
    ])
  })

  test("prefers the -ti trace id over the @joint declaration", async () => {
    const traceIds: string[] = []

    await runJointChain({
      root: "/root",
      jointPath: "/root/chain.joint.nts",
      joint: jointScope([{ run: "only" }], "file-trace"),
      cliTraceId: "cli-trace",
      runStep: async (options) => {
        traceIds.push(options.traceId)
        return jsonResponse({})
      },
    })

    expect(traceIds).toEqual(["cli-trace"])
  })

  test("generates a joint trace id when none is declared", async () => {
    const traceIds: string[] = []

    const result = await runJointChain({
      root: "/root",
      jointPath: "/root/chain.joint.nts",
      joint: jointScope([{ run: "only" }]),
      runStep: async (options) => {
        traceIds.push(options.traceId)
        return jsonResponse({})
      },
    })

    expect(traceIds[0]).toMatch(/^joint-\d+-[0-9a-f-]{8}$/)
    expect(result.traceId).toBe(traceIds[0])
  })

  test("stops the chain when a step fails and reports the step context", async () => {
    const sources: string[] = []
    const failure = new Error("boom")

    const chain = runJointChain({
      root: "/root",
      jointPath: "/root/chain.joint.nts",
      joint: jointScope([
        { run: "first" },
        { run: "second" },
        { run: "third" },
      ]),
      cliTraceId: "t",
      runStep: async (options) => {
        sources.push(options.source)

        if (sources.length === 2) {
          throw failure
        }

        return jsonResponse({})
      },
    })

    await expect(chain).rejects.toThrow(JointStepError)
    await chain.catch((error: unknown) => {
      expect(isJointStepError(error)).toBe(true)

      if (isJointStepError(error)) {
        expect(error.message).toBe("Joint step 2/3 (second) failed.")
        expect(error.stepIndex).toBe(1)
        expect(error.traceId).toBe("t")
        expect(error.cause).toBe(failure)
      }
    })
    expect(sources).toEqual(["/root/first.nts", "/root/second.nts"])
  })

  test("rejects steps that run another joint file", async () => {
    const chain = runJointChain({
      root: "/root",
      jointPath: "/root/chain.joint.nts",
      joint: jointScope([{ run: "nested.joint" }]),
      runStep: async (options) => {
        options.validateScope(jointScope([{ run: "inner" }]))
        return jsonResponse({})
      },
    })

    await expect(chain).rejects.toThrow(JointStepError)
    await chain.catch((error: unknown) => {
      expect((error as JointStepError).cause).toEqual(
        new Error(
          "A joint file cannot @run another joint file (nested.joint).",
        ),
      )
    })
  })

  test("rejects steps whose request is not application/json", async () => {
    const chain = runJointChain({
      root: "/root",
      jointPath: "/root/chain.joint.nts",
      joint: jointScope([{ run: "form-step" }]),
      runStep: async (options) => {
        options.validateScope(requestScope("multipart/form-data"))
        return jsonResponse({})
      },
    })

    await expect(chain).rejects.toThrow(JointStepError)
    await chain.catch((error: unknown) => {
      expect(String((error as JointStepError).cause)).toContain(
        "@joint chains only allow application/json requests",
      )
    })
  })

  test("rejects steps whose response is not application/json", async () => {
    const chain = runJointChain({
      root: "/root",
      jointPath: "/root/chain.joint.nts",
      joint: jointScope([{ run: "text-step" }]),
      runStep: async () =>
        ({
          data: "plain text",
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/plain" },
          config: {},
        }) as AxiosResponse,
    })

    await expect(chain).rejects.toThrow(JointStepError)
    await chain.catch((error: unknown) => {
      expect(String((error as JointStepError).cause)).toContain(
        "@joint chains only allow application/json responses",
      )
    })
  })

  test("allows a bodyless response without a content type", async () => {
    const result = await runJointChain({
      root: "/root",
      jointPath: "/root/chain.joint.nts",
      joint: jointScope([{ run: "delete-step" }]),
      runStep: async () =>
        ({
          data: "",
          status: 204,
          statusText: "No Content",
          headers: {},
          config: {},
        }) as AxiosResponse,
    })

    expect(result.response.status).toBe(204)
  })

  test("invokes onStepComplete for intermediate steps only", async () => {
    const onStepComplete = jest.fn<(step: JointStepResult) => void>()

    await runJointChain({
      root: "/root",
      jointPath: "/root/queries/chain.joint.nts",
      joint: jointScope([{ run: "first" }, { run: "second" }], "t"),
      runStep: async () => jsonResponse({}),
      onStepComplete,
    })

    expect(onStepComplete).toHaveBeenCalledTimes(1)
    expect(onStepComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        stepIndex: 0,
        stepCount: 2,
        runTarget: "first",
        source: "queries/first.nts",
        traceId: "t",
      }),
    )
  })
})
