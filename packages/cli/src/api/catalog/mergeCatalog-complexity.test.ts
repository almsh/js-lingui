import { vi } from "vitest"

import {
  defaultMergeOptions,
  makeNextMessage,
  makePrevMessage,
} from "../../tests.js"
import { mergeCatalog } from "./mergeCatalog.js"
import { CatalogType, ExtractedCatalogType } from "../types.js"

function makeTrackedKeys(keys: string[]) {
  let accessCount = 0

  return {
    keys: new Proxy(keys, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          accessCount++
        }

        return Reflect.get(target, property, receiver)
      },
    }),
    getAccessCount: () => accessCount,
  }
}

describe("mergeCatalog complexity", () => {
  it("should avoid quadratic key lookups when merging catalogs", () => {
    const messageCount = 100
    const prevKeys = Array.from(
      { length: messageCount },
      (_, index) => `prev.${index}`,
    )
    const nextKeys = Array.from(
      { length: messageCount },
      (_, index) => `next.${index}`,
    )

    const prevCatalog = Object.fromEntries(
      prevKeys.map((key) => [
        key,
        makePrevMessage({ translation: `Translation ${key}` }),
      ]),
    ) as CatalogType

    const nextCatalog = Object.fromEntries(
      nextKeys.map((key) => [
        key,
        makeNextMessage({ message: `Message ${key}` }),
      ]),
    ) as ExtractedCatalogType

    const trackedPrevKeys = makeTrackedKeys(prevKeys)
    const trackedNextKeys = makeTrackedKeys(nextKeys)
    const objectKeys = Object.keys
    const objectKeysSpy = vi
      .spyOn(Object, "keys")
      .mockImplementation((value) => {
        if (value === prevCatalog) {
          return trackedPrevKeys.keys
        }

        if (value === nextCatalog) {
          return trackedNextKeys.keys
        }

        return objectKeys(value)
      })

    try {
      mergeCatalog(prevCatalog, nextCatalog, false, defaultMergeOptions)
    } finally {
      objectKeysSpy.mockRestore()
    }

    expect(
      trackedPrevKeys.getAccessCount() + trackedNextKeys.getAccessCount(),
    ).toBeLessThan(prevKeys.length * nextKeys.length)
  })
})
