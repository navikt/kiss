/**
 * Database seed script – populates local Postgres with test data.
 * Run with: pnpm db:seed
 */
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema/index"

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://kiss:kiss@localhost:5432/kiss"

async function seed() {
	const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 })
	const db = drizzle(pool, { schema })

	console.log("🌱 Seeding database...")

	// 1. Sections
	const [seksjonUtvikling] = await db
		.insert(schema.sections)
		.values({
			name: "Utvikling",
			slug: "utvikling",
			description: "Seksjon for systemutvikling og forvaltning",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.onConflictDoNothing()
		.returning()

	const sectionId = seksjonUtvikling?.id
	if (!sectionId) {
		console.log("ℹ️  Sections already seeded, skipping...")
		await pool.end()
		return
	}

	// 2. Dev teams
	const teams = await db
		.insert(schema.devTeams)
		.values([
			{ name: "Team Alfa", slug: "team-alfa", sectionId, createdBy: "seed", updatedBy: "seed" },
			{ name: "Team Bravo", slug: "team-bravo", sectionId, createdBy: "seed", updatedBy: "seed" },
			{ name: "Team Charlie", slug: "team-charlie", sectionId, createdBy: "seed", updatedBy: "seed" },
			{ name: "Team Delta", slug: "team-delta", sectionId, createdBy: "seed", updatedBy: "seed" },
		])
		.onConflictDoNothing()
		.returning()

	console.log(`  ✓ ${teams.length} dev teams`)

	// 3. Nais teams (skipped if real sync has populated data)
	const naisTeams = await db
		.insert(schema.naisTeams)
		.values([
			{ slug: "team-pensjon", status: "monitored", discoveredAt: new Date("2026-03-01") },
			{ slug: "team-arbeid", status: "monitored", discoveredAt: new Date("2026-03-01") },
			{ slug: "team-helserefusjon", status: "pending", discoveredAt: new Date("2026-03-28") },
			{ slug: "team-deploy", status: "ignored", discoveredAt: new Date("2026-03-15") },
		])
		.onConflictDoNothing()
		.returning()

	console.log(`  ✓ ${naisTeams.length} nais teams`)

	// 4. Monitored applications
	const apps = await db
		.insert(schema.monitoredApplications)
		.values([
			{ name: "pensjon-regler", createdBy: "seed", updatedBy: "seed" },
			{ name: "arbeid-api", createdBy: "seed", updatedBy: "seed" },
			{ name: "helserefusjon-web", createdBy: "seed", updatedBy: "seed" },
		])
		.onConflictDoNothing()
		.returning()

	console.log(`  ✓ ${apps.length} monitored applications`)

	// 5. Framework version (import log)
	const [fwVersion] = await db
		.insert(schema.frameworkVersions)
		.values({
			name: "Minimum kontrollrammeverk (v1.1)",
			description: "Kontrollrammeverk for integrert sikker systemutvikling",
			sourceFileName: "Minimum kontrollrammeverk økonomisystem (v1.1).xlsx",
			sourceBucketPath: "framework-uploads/mkr-v1.1.xlsx",
			status: "applied",
			activatedAt: new Date(),
			activatedBy: "seed",
			createdBy: "seed",
		})
		.returning()

	// 6. Framework domains (live entities — no versionId)
	const domainData = [
		{ code: "ST", name: "Styring", displayOrder: 1 },
		{ code: "TS", name: "Tilgangsstyring", displayOrder: 2 },
		{ code: "EH", name: "Endringshåndtering", displayOrder: 3 },
		{ code: "DR", name: "Drift", displayOrder: 4 },
	]

	const domains = await db
		.insert(schema.frameworkDomains)
		.values(domainData.map((d) => ({ ...d, lastImportId: fwVersion.id })))
		.returning()

	console.log(`  ✓ ${domains.length} framework domains`)

	const domainMap = Object.fromEntries(domains.map((d) => [d.code, d.id]))

	// 7. Framework risks + controls
	const riskControlData: Array<{
		domainCode: string
		riskId: string
		riskDesc: string
		controls: Array<{ controlId: string; name: string }>
	}> = [
		{
			domainCode: "ST",
			riskId: "R-ST.01",
			riskDesc: "Mangelfull styring av IT-sikkerhet og kontrollmiljø",
			controls: [{ controlId: "K-ST.01", name: "Etablert sikkerhetspolicy og styringsrammeverk" }],
		},
		{
			domainCode: "ST",
			riskId: "R-ST.02",
			riskDesc: "Mangelfull risikovurdering og oppfølging",
			controls: [{ controlId: "K-ST.02", name: "Periodisk risikovurdering og oppfølging" }],
		},
		{
			domainCode: "TS",
			riskId: "R-TS.01",
			riskDesc: "Uautorisert tilgang til systemer og data",
			controls: [
				{ controlId: "K-TS.01", name: "Tilgangspolicy og rollebasert tilgangskontroll" },
				{ controlId: "K-TS.02", name: "Brukeropprettelse og godkjenning" },
				{ controlId: "K-TS.03", name: "Periodisk gjennomgang av tilganger" },
				{ controlId: "K-TS.04", name: "Fjerning av tilganger ved endring/avslutning" },
				{ controlId: "K-TS.05", name: "Privilegert tilgangsstyring" },
				{ controlId: "K-TS.06", name: "Autentiseringsmekanismer og flerfaktorautentisering" },
			],
		},
		{
			domainCode: "TS",
			riskId: "R-TS.02",
			riskDesc: "Uautorisert tilgang til infrastruktur og nettverk",
			controls: [
				{ controlId: "K-TS.07", name: "Nettverkssegmentering og brannmurregler" },
				{ controlId: "K-TS.08", name: "Logging og overvåking av tilganger" },
				{ controlId: "K-TS.09", name: "Sikker fjerntilgang (VPN/Zero Trust)" },
				{ controlId: "K-TS.10", name: "Tjenestekonto- og API-nøkkelhåndtering" },
				{ controlId: "K-TS.11", name: "Fysisk tilgangskontroll til datasentre" },
			],
		},
		{
			domainCode: "EH",
			riskId: "R-EH.01",
			riskDesc: "Uautoriserte eller feilaktige endringer i produksjonsmiljø",
			controls: [
				{ controlId: "K-EH.01", name: "Formell endringshåndteringsprosess" },
				{ controlId: "K-EH.02", name: "Segregering av utviklings-, test- og produksjonsmiljø" },
				{ controlId: "K-EH.03", name: "Kodegjennomgang og godkjenning før produksjonssetting" },
				{ controlId: "K-EH.04", name: "Automatisert bygg- og distribusjonspipeline" },
				{ controlId: "K-EH.05", name: "Nødendringsprosedyre" },
			],
		},
		{
			domainCode: "DR",
			riskId: "R-TI.01",
			riskDesc: "Tap av data eller manglende gjenoppretting",
			controls: [{ controlId: "K-DR.01", name: "Sikkerhetskopiering og gjenopprettingstesting" }],
		},
		{
			domainCode: "DR",
			riskId: "R-TI.02",
			riskDesc: "Nedetid og manglende tilgjengelighet",
			controls: [{ controlId: "K-DR.02", name: "Overvåking, varsling og hendelseshåndtering" }],
		},
		{
			domainCode: "DR",
			riskId: "R-TI.03",
			riskDesc: "Sikkerhetshendelser og datainnbrudd",
			controls: [
				{ controlId: "K-DR.03", name: "Sårbarhetshåndtering og patching" },
				{ controlId: "K-DR.04", name: "Sikkerhetslogging og hendelsesrespons" },
			],
		},
		{
			domainCode: "DR",
			riskId: "R-DR.04",
			riskDesc: "Manglende driftskontinuitet",
			controls: [
				{ controlId: "K-DR.05", name: "Kapasitetsstyring og ytelsesovervåking" },
				{ controlId: "K-DR.06", name: "Kontinuitetsplan og katastrofegjenoppretting" },
			],
		},
	]

	let riskCount = 0
	let controlCount = 0
	const controlUuidMap: Record<string, string> = {}

	for (const rc of riskControlData) {
		const [risk] = await db
			.insert(schema.frameworkRisks)
			.values({
				domainId: domainMap[rc.domainCode],
				riskId: rc.riskId,
				description: rc.riskDesc,
				lastImportId: fwVersion.id,
			})
			.returning()
		riskCount++

		for (const ctrl of rc.controls) {
			const [control] = await db
				.insert(schema.frameworkControls)
				.values({
					domainId: domainMap[rc.domainCode],
					controlId: ctrl.controlId,
					technologyElement: ctrl.controlId === "K-ST.01" ? "Styringsverktøy, dokumenthåndteringssystem" : null,
					requirement:
						ctrl.controlId === "K-ST.01"
							? "Organisasjonen skal ha en dokumentert og godkjent IT-sikkerhetspolicy"
							: null,
					lastImportId: fwVersion.id,
				})
				.returning()
			controlCount++
			controlUuidMap[ctrl.controlId] = control.id

			await db.insert(schema.frameworkRiskControlMappings).values({
				riskId: risk.id,
				controlId: control.id,
			})
		}
	}

	console.log(`  ✓ ${riskCount} risks, ${controlCount} controls`)

	// 8. Sample compliance assessments
	const [pensjonRegler] = apps.filter((a) => a.name === "pensjon-regler")
	if (pensjonRegler && controlUuidMap["K-ST.01"] && controlUuidMap["K-TS.01"]) {
		await db.insert(schema.complianceAssessments).values({
			applicationId: pensjonRegler.id,
			controlId: controlUuidMap["K-ST.01"],
			status: "implemented",
			comment: "Gjennomgått Q1 2026. Se https://jira.nav.no/browse/KISS-123",
			assessedBy: "A123456",
			createdBy: "seed",
			updatedBy: "seed",
		})

		await db.insert(schema.complianceAssessments).values({
			applicationId: pensjonRegler.id,
			controlId: controlUuidMap["K-TS.01"],
			status: "partially_implemented",
			comment: "AD-grupper er satt opp, men periodisk gjennomgang mangler.",
			assessedBy: "B654321",
			createdBy: "seed",
			updatedBy: "seed",
		})

		console.log("  ✓ Sample compliance assessments")
	}

	// 9. Users
	await db
		.insert(schema.users)
		.values([
			{ navIdent: "A123456", name: "Kari Nordmann", email: "kari.nordmann@nav.no" },
			{ navIdent: "B654321", name: "Ola Hansen", email: "ola.hansen@nav.no" },
		])
		.onConflictDoNothing()

	console.log("  ✓ Sample users")
	console.log("🌱 Seeding complete!")

	await pool.end()
}

seed().catch((err) => {
	console.error("❌ Seed failed:", err)
	process.exit(1)
})
