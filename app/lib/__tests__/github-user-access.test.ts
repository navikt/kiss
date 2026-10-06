import { describe, expect, it } from "vitest"
import { computeGithubUserAccess, highestGithubPermission } from "~/lib/github-user-access"

describe("highestGithubPermission", () => {
	it("returns the highest-ranked permission present", () => {
		expect(highestGithubPermission(["pull", "admin", "push"])).toBe("admin")
		expect(highestGithubPermission(["read", "triage"])).toBe("triage")
	})

	it("falls back to the first entry for unrecognized permissions", () => {
		expect(highestGithubPermission(["custom-role"])).toBe("custom-role")
	})

	it("returns 'unknown' for an empty list", () => {
		expect(highestGithubPermission([])).toBe("unknown")
	})
})

describe("computeGithubUserAccess", () => {
	it("merges direct collaborator access and team membership per user", () => {
		const result = computeGithubUserAccess(
			[
				{
					teamSlug: "dev-team",
					teamName: "Dev Team",
					permission: "push",
					members: [
						{ username: "alice", role: "member" },
						{ username: "bob", role: "maintainer" },
					],
				},
			],
			[{ username: "alice", permission: "admin" }],
		)

		const alice = result.find((u) => u.username === "alice")
		expect(alice).toMatchObject({
			username: "alice",
			highestPermission: "admin",
			directPermission: "admin",
			viaTeams: [{ teamSlug: "dev-team", teamName: "Dev Team", permission: "push" }],
		})

		const bob = result.find((u) => u.username === "bob")
		expect(bob).toMatchObject({
			username: "bob",
			highestPermission: "push",
			directPermission: null,
			viaTeams: [{ teamSlug: "dev-team", teamName: "Dev Team", permission: "push" }],
		})
	})

	it("aggregates permissions across multiple teams for the same user", () => {
		const result = computeGithubUserAccess(
			[
				{
					teamSlug: "team-a",
					teamName: "Team A",
					permission: "pull",
					members: [{ username: "carol", role: "member" }],
				},
				{
					teamSlug: "team-b",
					teamName: "Team B",
					permission: "maintain",
					members: [{ username: "carol", role: "member" }],
				},
			],
			[],
		)

		const carol = result.find((u) => u.username === "carol")
		expect(carol?.highestPermission).toBe("maintain")
		expect(carol?.viaTeams).toHaveLength(2)
	})

	it("sorts by permission rank, then by username", () => {
		const result = computeGithubUserAccess(
			[],
			[
				{ username: "zed", permission: "admin" },
				{ username: "amy", permission: "admin" },
				{ username: "bo", permission: "read" },
			],
		)
		expect(result.map((u) => u.username)).toEqual(["amy", "zed", "bo"])
	})
})
