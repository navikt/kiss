import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSearchApplications = vi.fn()
vi.mock("~/db/queries/applications.server", () => ({
	searchApplications: (...args: unknown[]) => mockSearchApplications(...args),
}))

const mockGetControlDomainMap = vi.fn()
vi.mock("~/db/queries/framework.server", () => ({
	getControlDomainMap: (...args: unknown[]) => mockGetControlDomainMap(...args),
}))

function makeQueryResult<T>(rows: T[]) {
	return {
		from() {
			return this
		},
		innerJoin() {
			return this
		},
		where() {
			return this
		},
		limit() {
			return Promise.resolve(rows)
		},
	}
}

const selectMock = vi.fn(() => makeQueryResult([]))
vi.mock("~/db/connection.server", () => ({
	db: {
		select: () => selectMock(),
	},
}))

const { loader } = await import("../index")

describe("api.search loader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		selectMock.mockImplementation(() => makeQueryResult([]))
		mockSearchApplications.mockResolvedValue([])
		mockGetControlDomainMap.mockResolvedValue(new Map())
	})

	it("delegates application lookups to searchApplications", async () => {
		mockSearchApplications.mockResolvedValue([])

		const rawUrl = "http://localhost/api/search?q=pensjon"
		const response = await loader({
			request: new Request(rawUrl),
			params: {},
			url: new URL(rawUrl),
			context: {},
		} as unknown as Parameters<typeof loader>[0])

		expect(mockSearchApplications).toHaveBeenCalledWith("pensjon", 200)
		expect(response).toBeInstanceOf(Response)
		const payload = await (response as Response).json()
		expect(payload.results).toEqual([])
	})
})
