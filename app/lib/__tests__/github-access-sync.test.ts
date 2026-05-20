import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock dependencies
const mockWithAdvisoryLock = vi.fn()
vi.mock("~/lib/lock.server", () => ({
	withAdvisoryLock: (...args: unknown[]) => mockWithAdvisoryLock(...args),
}))

vi.mock("~/lib/logger.server", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockGetRepoTeams = vi.fn()
const mockGetRepoCollaborators = vi.fn()
const mockGetTeamMembers = vi.fn()
const mockIsConfigured = vi.fn()

vi.mock("~/lib/github.server", () => ({
	getRepoTeams: (...args: unknown[]) => mockGetRepoTeams(...args),
	getRepoCollaborators: (...args: unknown[]) => mockGetRepoCollaborators(...args),
	getTeamMembers: (...args: unknown[]) => mockGetTeamMembers(...args),
	isGitHubAppConfigured: () => mockIsConfigured(),
}))

// Mock DB
const mockDbSelect = vi.fn()
const mockDbTransaction = vi.fn()
vi.mock("~/db/connection.server", () => ({
	db: {
		select: (...args: unknown[]) => mockDbSelect(...args),
		transaction: (...args: unknown[]) => mockDbTransaction(...args),
	},
}))

vi.mock("~/db/queries/audit.server", () => ({
	writeAuditLog: vi.fn(),
}))

vi.mock("~/db/schema/applications", () => ({
	monitoredApplications: { id: "id", name: "name", gitRepository: "git_repository", archivedAt: "archived_at" },
	applicationEnvironments: {
		applicationId: "application_id",
		gitRepository: "git_repository",
		discoveredAt: "discovered_at",
	},
}))

vi.mock("~/db/schema/github-access", () => ({
	githubRepoTeams: {
		id: "id",
		applicationId: "application_id",
		teamSlug: "team_slug",
		teamName: "team_name",
		permission: "permission",
		syncedAt: "synced_at",
	},
	githubRepoTeamMembers: { id: "id", repoTeamId: "repo_team_id", username: "username", role: "role" },
	githubRepoCollaborators: {
		id: "id",
		applicationId: "application_id",
		username: "username",
		permission: "permission",
	},
}))

const { runGitHubAccessSync, parseGitRepository } = await import("~/lib/github-access-sync.server")

describe("parseGitRepository", () => {
	it("parses owner/repo format", () => {
		expect(parseGitRepository("navikt/pen")).toEqual({ owner: "navikt", repo: "pen" })
	})

	it("parses https://github.com/owner/repo URL", () => {
		expect(parseGitRepository("https://github.com/navikt/pensjon-pen")).toEqual({
			owner: "navikt",
			repo: "pensjon-pen",
		})
	})

	it("strips trailing slash", () => {
		expect(parseGitRepository("https://github.com/navikt/pen/")).toEqual({ owner: "navikt", repo: "pen" })
	})

	it("strips .git suffix", () => {
		expect(parseGitRepository("https://github.com/navikt/pen.git")).toEqual({ owner: "navikt", repo: "pen" })
	})

	it("handles http:// URLs", () => {
		expect(parseGitRepository("http://github.com/navikt/pen")).toEqual({ owner: "navikt", repo: "pen" })
	})

	it("throws on invalid format", () => {
		expect(() => parseGitRepository("just-a-name")).toThrow("Invalid git repository format")
	})

	it("throws on URLs with extra path segments", () => {
		expect(() => parseGitRepository("https://github.com/navikt/repo/tree/main")).toThrow(
			"Invalid git repository format",
		)
	})
})

describe("runGitHubAccessSync", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns not_configured when GitHub App is not configured", async () => {
		mockIsConfigured.mockReturnValue(false)

		const outcome = await runGitHubAccessSync()

		expect(outcome).toEqual({ status: "not_configured" })
		expect(mockWithAdvisoryLock).not.toHaveBeenCalled()
	})

	it("returns lock_held when another pod holds the lock", async () => {
		mockIsConfigured.mockReturnValue(true)
		mockWithAdvisoryLock.mockResolvedValue(null)

		const outcome = await runGitHubAccessSync()

		expect(outcome).toEqual({ status: "lock_held" })
	})

	it("processes apps with gitRepository and reports results", async () => {
		mockIsConfigured.mockReturnValue(true)
		mockWithAdvisoryLock.mockImplementation(async (_name: string, fn: () => Promise<unknown>) => fn())

		// Mock DB select: two calls inside advisory lock (direct repo + env repo)
		mockDbSelect
			.mockReturnValueOnce({
				from: () => ({
					where: () =>
						Promise.resolve([
							{ id: "app-1", gitRepository: "navikt/pen" },
							{ id: "app-2", gitRepository: "navikt/modia" },
						]),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => Promise.resolve([]),
				}),
			})

		// Mock GitHub API responses
		mockGetRepoTeams.mockResolvedValue([{ slug: "team-a", name: "Team A", permission: "push" }])
		mockGetRepoCollaborators.mockResolvedValue([{ login: "alice", role_name: "admin" }])
		mockGetTeamMembers.mockResolvedValue([{ login: "bob", role: "member" }])

		// Mock transaction to execute the callback
		mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
			const mockTx = {
				select: () => ({
					from: () => ({
						where: () => Promise.resolve([]),
					}),
				}),
				insert: () => ({
					values: () => ({
						returning: () => Promise.resolve([{ id: "new-team-id" }]),
					}),
				}),
				delete: () => ({
					where: () => Promise.resolve(),
				}),
			}
			return fn(mockTx)
		})

		const outcome = await runGitHubAccessSync()

		expect(outcome.status).toBe("success")
		if (outcome.status === "success") {
			expect(outcome.result.appsProcessed).toBe(2)
			expect(outcome.result.errors).toBe(0)
		}
		expect(mockGetRepoTeams).toHaveBeenCalledTimes(2)
		expect(mockGetRepoCollaborators).toHaveBeenCalledTimes(2)
	})

	it("continues on per-app errors and counts them", async () => {
		mockIsConfigured.mockReturnValue(true)
		mockWithAdvisoryLock.mockImplementation(async (_name: string, fn: () => Promise<unknown>) => fn())

		mockDbSelect
			.mockReturnValueOnce({
				from: () => ({
					where: () => Promise.resolve([{ id: "app-1", gitRepository: "navikt/pen" }]),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => Promise.resolve([]),
				}),
			})

		mockGetRepoTeams.mockRejectedValue(new Error("GitHub API error: 403"))

		const outcome = await runGitHubAccessSync()

		expect(outcome.status).toBe("success")
		if (outcome.status === "success") {
			expect(outcome.result.appsProcessed).toBe(0)
			expect(outcome.result.errors).toBe(1)
		}
	})

	it("detects permission changes, removals, and writes audit log", async () => {
		mockIsConfigured.mockReturnValue(true)
		mockWithAdvisoryLock.mockImplementation(async (_name: string, fn: () => Promise<unknown>) => fn())

		mockDbSelect
			.mockReturnValueOnce({
				from: () => ({
					where: () => Promise.resolve([{ id: "app-1", gitRepository: "navikt/pen" }]),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => Promise.resolve([]),
				}),
			})

		// GitHub returns team-a with NEW permission (was push, now admin)
		mockGetRepoTeams.mockResolvedValue([{ slug: "team-a", name: "Team A", permission: "admin" }])
		mockGetRepoCollaborators.mockResolvedValue([])
		mockGetTeamMembers.mockResolvedValue([{ login: "alice", role: "member" }])

		const mockUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) })
		const mockDelete = vi.fn().mockReturnValue({ where: vi.fn() })
		const { writeAuditLog: mockWriteAuditLog } = await import("~/db/queries/audit.server")

		mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
			const mockTx = {
				select: () => ({
					from: () => ({
						where: () =>
							// Return existing team with OLD permission
							Promise.resolve([
								{
									id: "existing-team-id",
									teamSlug: "team-a",
									teamName: "Team A",
									permission: "push",
									syncedAt: new Date(),
								},
							]),
					}),
				}),
				insert: () => ({
					values: () => ({
						returning: () => Promise.resolve([{ id: "new-team-id" }]),
					}),
				}),
				update: mockUpdate,
				delete: mockDelete,
			}
			return fn(mockTx)
		})

		const outcome = await runGitHubAccessSync()

		expect(outcome.status).toBe("success")
		if (outcome.status === "success") {
			expect(outcome.result.appsProcessed).toBe(1)
			expect(outcome.result.teamsUpdated).toBeGreaterThanOrEqual(1)
		}
		// Audit log should have been called for the permission change
		expect(mockWriteAuditLog).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "github_access_team_permission_changed",
				entityId: "app-1",
			}),
			expect.anything(),
		)
	})
})
