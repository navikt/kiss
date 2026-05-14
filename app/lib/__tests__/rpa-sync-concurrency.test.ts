import { describe, expect, it } from "vitest"

const { _testing } = await import("~/lib/rpa-sync.server")

describe("rpa sync concurrency helper", () => {
	it("mapWithConcurrency respects concurrency limit", async () => {
		const items = Array.from({ length: 20 }, (_, i) => i + 1)
		let active = 0
		let maxActive = 0

		const results = await _testing.mapWithConcurrency(items, 3, async (item: number) => {
			active++
			maxActive = Math.max(maxActive, active)
			await new Promise((resolve) => setTimeout(resolve, 5))
			active--
			return item * 2
		})

		expect(results).toHaveLength(20)
		expect(maxActive).toBeLessThanOrEqual(3)
		expect(results.every((r: { error?: unknown }) => r.error === undefined)).toBe(true)
		expect(results.map((r: { value?: number }) => r.value).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
			items.map((n) => n * 2).sort((a, b) => a - b),
		)
	})
})
