import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const {
	archiveMissingEnvironmentAccessPolicyRules,
	createAccessPolicySyncSummaryCollector,
	getMonitoredAppsForNaisTeam,
	getAccessPolicyRules,
	upsertAccessPolicyRules,
	upsertAccessPolicyRulesForEnvironment,
	upsertAppEnvironment,
	upsertMonitoredApp,
} = await import("~/db/queries/nais.server")

async function createNaisTeam(slug: string): Promise<string> {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO nais_teams (slug, app_count, status) VALUES ('${slug}', 0, 'monitored') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createSection(slug: string): Promise<string> {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${slug}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, metadata, performed_by FROM audit_log WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY performed_at, action`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		metadata: string | null
		performed_by: string
	}>
}

describe("Access policy rules per environment", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `DELETE FROM application_environment_access_policy_rules`)
		await db.execute(/* sql */ `DELETE FROM application_access_policy_rules`)
		await db.execute(/* sql */ `DELETE FROM application_access_policy_fallback_cutovers`)
		await db.execute(/* sql */ `DELETE FROM application_environments`)
		await db.execute(/* sql */ `DELETE FROM section_environments`)
		await db.execute(/* sql */ `DELETE FROM monitored_applications`)
		await db.execute(/* sql */ `DELETE FROM nais_teams`)
		await db.execute(/* sql */ `DELETE FROM sections`)
		await db.execute(/* sql */ `DELETE FROM audit_log`)
	})

	it("stores rules per environment and returns union on read", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)

		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)
		const fssEnv = await upsertAppEnvironment(app.id, "prod-fss", "teampensjon", teamId)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[
				{ application: "pen-nks-service", namespace: "pensjon-saksbehandling", cluster: "prod-gcp" },
				{ application: "pensjon-pselv", namespace: "pensjondeployer", cluster: "prod-gcp" },
			],
			"nais-sync",
		)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			fssEnv.id,
			"inbound",
			[
				{ application: "pen-nks-service", namespace: "pensjon-saksbehandling", cluster: "prod-fss" },
				{ application: "pensjon-pselv", namespace: "pensjondeployer", cluster: "prod-gcp" },
			],
			"nais-sync",
		)

		const merged = await getAccessPolicyRules(app.id)
		expect(merged).toHaveLength(3)
		expect(merged.map((r) => `${r.ruleApplication}|${r.ruleNamespace ?? ""}|${r.ruleCluster ?? ""}`).sort()).toEqual([
			"pen-nks-service|pensjon-saksbehandling|prod-fss",
			"pen-nks-service|pensjon-saksbehandling|prod-gcp",
			"pensjon-pselv|pensjondeployer|prod-gcp",
		])
	})

	it("archives stale rules when an environment disappears from sync", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)

		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)
		const devEnv = await upsertAppEnvironment(app.id, "dev-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "prod-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)
		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			devEnv.id,
			"inbound",
			[{ application: "dev-client", namespace: "teampensjon", cluster: "dev-gcp" }],
			"nais-sync",
		)

		await archiveMissingEnvironmentAccessPolicyRules(app.id, teamId, [prodEnv.id], ["inbound"], "nais-sync")

		const merged = await getAccessPolicyRules(app.id)
		expect(merged).toHaveLength(1)
		expect(merged[0].ruleApplication).toBe("prod-client")

		const audit = await getAuditByEntity("application", app.id)
		const added = audit.filter((a) => a.action === "access_policy_rule_added")
		const removed = audit.filter((a) => a.action === "access_policy_rule_removed")
		expect(added).toHaveLength(2)
		expect(removed).toHaveLength(1)
		expect(JSON.parse(removed[0].previous_value as string)).toMatchObject({
			direction: "inbound",
			ruleApplication: "dev-client",
			ruleCluster: "dev-gcp",
		})
	})

	it("archives stale rules when app disappears entirely from team sync", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)

		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)
		const devEnv = await upsertAppEnvironment(app.id, "dev-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "prod-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)
		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			devEnv.id,
			"inbound",
			[{ application: "dev-client", namespace: "teampensjon", cluster: "dev-gcp" }],
			"nais-sync",
		)
		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[{ application: "legacy-client", namespace: "teampensjon", cluster: "legacy-gcp" }],
			"nais-sync",
		)

		await archiveMissingEnvironmentAccessPolicyRules(app.id, teamId, [], ["inbound"], "nais-sync")

		const merged = await getAccessPolicyRules(app.id)
		expect(merged).toHaveLength(0)
	})

	it("keeps legacy outbound rules while inbound is sourced from environment table", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRules(app.id, "outbound", [{ application: "legacy-outbound-app" }], "nais-sync")

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "env-inbound-app", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)

		const merged = await getAccessPolicyRules(app.id)
		expect(merged.map((r) => `${r.direction}:${r.ruleApplication}`).sort()).toEqual([
			"inbound:env-inbound-app",
			"outbound:legacy-outbound-app",
		])
	})

	it("does not reintroduce legacy inbound rules when environment rules are active", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[
				{ application: "shared-client", namespace: "teampensjon", cluster: "prod-gcp" },
				{ application: "legacy-only-client", namespace: "teampensjon", cluster: "dev-gcp" },
			],
			"nais-sync",
		)
		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "shared-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)

		const merged = await getAccessPolicyRules(app.id)
		expect(merged.map((r) => `${r.direction}:${r.ruleApplication}:${r.ruleCluster ?? ""}`)).toEqual([
			"inbound:shared-client:prod-gcp",
		])
	})

	it("does not expose inbound legacy fallback when there are no active environment rules", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)
		await upsertAppEnvironment(app.id, "dev-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[
				{ application: "legacy-client-a", namespace: "teampensjon", cluster: "prod-gcp" },
				{ application: "legacy-client-b", namespace: "teampensjon", cluster: "dev-gcp" },
			],
			"nais-sync",
		)

		await upsertAccessPolicyRulesForEnvironment(app.id, prodEnv.id, "inbound", [], "nais-sync")

		const merged = await getAccessPolicyRules(app.id)
		expect(merged).toHaveLength(0)
	})

	it("suppresses stale legacy inbound rules when environment sync reports empty rules", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[{ application: "legacy-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)
		await upsertAccessPolicyRulesForEnvironment(app.id, prodEnv.id, "inbound", [], "nais-sync")

		const merged = await getAccessPolicyRules(app.id)
		expect(merged).toHaveLength(0)
	})

	it("keeps legacy fallback disabled after cutover, even when a new environment appears", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[{ application: "legacy-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "env-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)

		const devEnv = await upsertAppEnvironment(app.id, "dev-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRulesForEnvironment(app.id, prodEnv.id, "inbound", [], "nais-sync")

		const merged = await getAccessPolicyRules(app.id)
		expect(merged).toHaveLength(0)

		await upsertAccessPolicyRulesForEnvironment(app.id, devEnv.id, "inbound", [], "nais-sync")
		const mergedAfterDevMarker = await getAccessPolicyRules(app.id)
		expect(mergedAfterDevMarker).toHaveLength(0)
	})

	it("backfills naisTeamId on existing environment rows", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)

		const envWithoutTeam = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", null)
		const envWithTeam = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)

		expect(envWithTeam.id).toBe(envWithoutTeam.id)
		const teamApps = await getMonitoredAppsForNaisTeam(teamId)
		expect(teamApps.map((a) => a.appId)).toContain(app.id)
	})

	it("registers section_environments cluster when backfilling naisTeamId on existing row", async () => {
		const db = getTestDb()
		const sectionId = await createSection("pensjon-section")
		const teamResult = await db.execute(
			/* sql */ `INSERT INTO nais_teams (slug, app_count, status, section_id) VALUES ('teampensjon-section', 0, 'monitored', '${sectionId}') RETURNING id`,
		)
		const teamId = (teamResult.rows[0] as { id: string }).id
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)

		await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", null)
		await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)

		const sectionEnvRows = await db.execute(
			/* sql */ `SELECT cluster FROM section_environments WHERE section_id = '${sectionId}'`,
		)
		expect(sectionEnvRows.rows).toHaveLength(1)
		expect((sectionEnvRows.rows[0] as { cluster: string }).cluster).toBe("prod-gcp")
	})

	it("writes app-level audit only when environment changes affect app-level union", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)
		const devEnv = await upsertAppEnvironment(app.id, "dev-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "shared-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)
		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			devEnv.id,
			"inbound",
			[{ application: "shared-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)
		await upsertAccessPolicyRulesForEnvironment(app.id, devEnv.id, "inbound", [], "nais-sync")

		const audit = await getAuditByEntity("application", app.id)
		const added = audit.filter((a) => a.action === "access_policy_rule_added")
		const removed = audit.filter((a) => a.action === "access_policy_rule_removed")
		expect(added).toHaveLength(1)
		expect(removed).toHaveLength(0)
	})

	it("treats null and empty namespace/cluster as same union key for audit", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)
		const devEnv = await upsertAppEnvironment(app.id, "dev-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "shared-client" }],
			"nais-sync",
		)
		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			devEnv.id,
			"inbound",
			[{ application: "shared-client", namespace: "", cluster: "" }],
			"nais-sync",
		)
		await upsertAccessPolicyRulesForEnvironment(app.id, devEnv.id, "inbound", [], "nais-sync")

		const audit = await getAuditByEntity("application", app.id)
		const added = audit.filter((a) => a.action === "access_policy_rule_added")
		const removed = audit.filter((a) => a.action === "access_policy_rule_removed")
		expect(added).toHaveLength(1)
		expect(removed).toHaveLength(0)
	})

	it("does not write fallback suppression audit when inbound fallback is retired", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[{ application: "legacy-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)

		await upsertAccessPolicyRulesForEnvironment(app.id, prodEnv.id, "inbound", [], "nais-sync")

		const audit = await getAuditByEntity("application", app.id)
		const removed = audit.filter((a) => a.action === "access_policy_rule_removed")
		expect(removed).toHaveLength(0)
	})

	it("tracks summary counts from real union-level audits", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)
		const devEnv = await upsertAppEnvironment(app.id, "dev-gcp", "teampensjon", teamId)
		const collector = createAccessPolicySyncSummaryCollector()
		const syncRunId = "summary-union-test"

		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[{ application: "legacy-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)
		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "legacy-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
			{ accessPolicySyncSummary: collector, syncRunId },
		)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			devEnv.id,
			"inbound",
			[
				{ application: "legacy-client", namespace: "teampensjon", cluster: "prod-gcp" },
				{ application: "unique-client", namespace: "teampensjon", cluster: "dev-gcp" },
				{ application: "unique-client", namespace: "teampensjon", cluster: "dev-gcp" },
			],
			"nais-sync",
			{ accessPolicySyncSummary: collector, syncRunId },
		)

		await archiveMissingEnvironmentAccessPolicyRules(app.id, teamId, [prodEnv.id], ["inbound"], "nais-sync", {
			accessPolicySyncSummary: collector,
			syncRunId,
		})

		const auditAfter = await getAuditByEntity("application", app.id)
		const delta = auditAfter.filter((entry) => {
			if (!entry.metadata) return false
			const metadata = JSON.parse(entry.metadata)
			return metadata?.syncRunId === syncRunId
		})
		expect(delta.filter((a) => a.action === "access_policy_rule_added")).toHaveLength(2)
		expect(delta.filter((a) => a.action === "access_policy_rule_removed")).toHaveLength(1)
		expect(collector.applicationIds.size).toBe(1)
		expect(collector.applicationEnvironmentIds.size).toBe(2)
		expect([...collector.directions]).toEqual(["inbound"])
		expect(collector.addedRules).toBe(2)
		expect(collector.removedRules).toBe(1)
		expect(collector.cutovers).toBe(1)
	})

	it("rejects mismatched application/environment ids", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const appA = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const appB = await upsertMonitoredApp("pensjon-kodeverk-2", "nais-sync", teamId)
		const envA = await upsertAppEnvironment(appA.id, "prod-gcp", "teampensjon", teamId)

		await expect(
			upsertAccessPolicyRulesForEnvironment(
				appB.id,
				envA.id,
				"inbound",
				[{ application: "shared-client", namespace: "teampensjon", cluster: "prod-gcp" }],
				"nais-sync",
			),
		).rejects.toThrow("Mismatched application/environment")
	})

	it("archives legacy app-level rules when splitting shared app identity", async () => {
		const teamA = await createNaisTeam("teama")
		const teamB = await createNaisTeam("teamb")
		const shared = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamA)

		await upsertAppEnvironment(shared.id, "prod-gcp", "teama", teamA)
		await upsertAppEnvironment(shared.id, "prod-fss", "teamb", teamB)
		await upsertAccessPolicyRules(
			shared.id,
			"inbound",
			[{ application: "legacy-client", namespace: "teama", cluster: "prod-gcp" }],
			"nais-sync",
		)

		const split = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamA)
		expect(split.id).not.toBe(shared.id)

		const sharedAppRules = await getAccessPolicyRules(shared.id)
		expect(sharedAppRules).toHaveLength(0)

		const audit = await getAuditByEntity("application", shared.id)
		const removed = audit.filter((a) => a.action === "access_policy_rule_removed")
		expect(removed.length).toBeGreaterThanOrEqual(1)
		const metadata = typeof removed[0].metadata === "string" ? JSON.parse(removed[0].metadata) : removed[0].metadata
		expect(metadata).toMatchObject({
			suppressedByAppSplit: true,
		})
	})

	it("keeps legacy outbound rules on old app when split only migrates inbound", async () => {
		const teamA = await createNaisTeam("teama")
		const teamB = await createNaisTeam("teamb")
		const shared = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamA)

		await upsertAppEnvironment(shared.id, "prod-gcp", "teama", teamA)
		await upsertAppEnvironment(shared.id, "prod-fss", "teamb", teamB)
		await upsertAccessPolicyRules(shared.id, "inbound", [{ application: "legacy-inbound" }], "nais-sync")
		await upsertAccessPolicyRules(shared.id, "outbound", [{ application: "legacy-outbound" }], "nais-sync")

		await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamA)

		const sharedAppRules = await getAccessPolicyRules(shared.id)
		expect(sharedAppRules.map((r) => `${r.direction}:${r.ruleApplication}`)).toEqual(["outbound:legacy-outbound"])
	})

	it("emits added when first env rule appears after inbound fallback retirement", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[
				{ application: "shared-client", namespace: "teampensjon", cluster: "prod-gcp" },
				{ application: "legacy-only-client", namespace: "teampensjon", cluster: "dev-gcp" },
			],
			"nais-sync",
		)
		const auditBefore = await getAuditByEntity("application", app.id)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "shared-client", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)

		const auditAfter = await getAuditByEntity("application", app.id)
		const added = auditAfter.slice(auditBefore.length).filter((a) => a.action === "access_policy_rule_added")
		const removed = auditAfter.slice(auditBefore.length).filter((a) => a.action === "access_policy_rule_removed")
		expect(added).toHaveLength(1)
		expect(removed).toHaveLength(0)
	})

	it("logs removed when archiving last active env rule after inbound fallback retirement", async () => {
		const teamId = await createNaisTeam("teampensjon")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamId)
		const prodEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamId)
		await upsertAppEnvironment(app.id, "dev-gcp", "teampensjon", teamId)

		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[
				{ application: "legacy-shared", namespace: "teampensjon", cluster: "prod-gcp" },
				{ application: "legacy-only", namespace: "teampensjon", cluster: "dev-gcp" },
			],
			"nais-sync",
		)

		await upsertAccessPolicyRulesForEnvironment(
			app.id,
			prodEnv.id,
			"inbound",
			[{ application: "legacy-shared", namespace: "teampensjon", cluster: "prod-gcp" }],
			"nais-sync",
		)

		const auditBefore = await getAuditByEntity("application", app.id)
		await upsertAccessPolicyRulesForEnvironment(app.id, prodEnv.id, "inbound", [], "nais-sync")
		const auditAfter = await getAuditByEntity("application", app.id)

		const delta = auditAfter.slice(auditBefore.length)
		const added = delta.filter((a) => a.action === "access_policy_rule_added")
		const removed = delta.filter((a) => a.action === "access_policy_rule_removed")
		expect(removed).toHaveLength(1)
		expect(added).toHaveLength(0)
		expect(JSON.parse(removed[0].previous_value as string)).toMatchObject({ ruleApplication: "legacy-shared" })
	})

	it("suppresses legacy fallback when direction history is complete for covered teams", async () => {
		const teamA = await createNaisTeam("teampensjon")
		const teamB = await createNaisTeam("pensjondeployer")
		const app = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamA)

		const teamAEnv = await upsertAppEnvironment(app.id, "prod-gcp", "teampensjon", teamA)
		await upsertAppEnvironment(app.id, "prod-fss", "pensjondeployer", teamB)

		await upsertAccessPolicyRules(
			app.id,
			"inbound",
			[
				{ application: "legacy-client-a", namespace: "teampensjon", cluster: "prod-gcp" },
				{ application: "legacy-client-b", namespace: "pensjondeployer", cluster: "prod-fss" },
			],
			"nais-sync",
		)

		await upsertAccessPolicyRulesForEnvironment(app.id, teamAEnv.id, "inbound", [], "nais-sync")

		const merged = await getAccessPolicyRules(app.id)
		expect(merged).toHaveLength(0)
	})
})
