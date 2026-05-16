import { expect } from "@jest/globals"

expect.extend({
  toBeArrayOfSize(received: unknown, expectedSize: number) {
    const pass = Array.isArray(received) && received.length === expectedSize

    return {
      message: () =>
        `expected ${this.utils.printReceived(received)} ${
          this.isNot ? "not " : ""
        }to be an array of size ${this.utils.printExpected(expectedSize)}`,
      pass,
    }
  },
  toBeFunction(received: unknown) {
    const pass = typeof received === "function"

    return {
      message: () =>
        `expected ${this.utils.printReceived(received)} ${
          this.isNot ? "not " : ""
        }to be a function`,
      pass,
    }
  },
  toBeString(received: unknown) {
    const pass = typeof received === "string"

    return {
      message: () =>
        `expected ${this.utils.printReceived(received)} ${
          this.isNot ? "not " : ""
        }to be a string`,
      pass,
    }
  },
  toStartWith(received: unknown, expectedPrefix: string) {
    const pass =
      typeof received === "string" && received.startsWith(expectedPrefix)

    return {
      message: () =>
        `expected ${this.utils.printReceived(received)} ${
          this.isNot ? "not " : ""
        }to start with ${this.utils.printExpected(expectedPrefix)}`,
      pass,
    }
  },
})

declare module "expect" {
  interface Matchers<R> {
    toBeArrayOfSize(expectedSize: number): R
    toBeFunction(): R
    toBeString(): R
    toStartWith(expectedPrefix: string): R
  }
}
