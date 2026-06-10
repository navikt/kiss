/**
 * Database seed script – populates local Postgres with sample data.
 * Run with: pnpm db:seed
 *
 * Målet er at hver tabell som er addable via GUI har minst én sample-rad,
 * og at alt henger sammen via referanser. Skriptet er idempotent: hvis
 * seksjonen "utvikling" allerede finnes hopper det over alt.
 */
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema/index"

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://kiss:kiss@localhost:5432/kiss"

async function seed() {
	const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 })
	const db = drizzle(pool, { schema })

	console.log("🌱 Seeding database...")

	// ─── 1. Sections ───────────────────────────────────────────────────────
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

	// Sekundær seksjon for variasjon (demo)
	await db.insert(schema.sections).values({
		name: "Drift",
		slug: "drift",
		description: "Seksjon for drift og infrastruktur",
		createdBy: "seed",
		updatedBy: "seed",
	})

	console.log(`  ✓ 2 sections`)

	// ─── 2. Clusters + section environments ────────────────────────────────
	const [clusterPensjon] = await db
		.insert(schema.clusters)
		.values({
			sectionId,
			name: "Pensjon",
			slug: "pensjon",
			description: "Klynge for pensjonsteam",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	await db.insert(schema.sectionEnvironments).values([
		{ sectionId, cluster: "prod-gcp", included: true, addedBy: "seed", updatedBy: "seed" },
		{ sectionId, cluster: "dev-gcp", included: true, addedBy: "seed", updatedBy: "seed" },
		{ sectionId, cluster: "prod-fss", included: false, addedBy: "seed", updatedBy: "seed" },
	])

	// ─── 3. Dev teams ──────────────────────────────────────────────────────
	const teams = await db
		.insert(schema.devTeams)
		.values([
			{
				name: "Team Alfa",
				slug: "team-alfa",
				sectionId,
				clusterId: clusterPensjon.id,
				description: "Pensjonsregler og kalkyle",
				createdBy: "seed",
				updatedBy: "seed",
			},
			{
				name: "Team Bravo",
				slug: "team-bravo",
				sectionId,
				clusterId: clusterPensjon.id,
				createdBy: "seed",
				updatedBy: "seed",
			},
			{ name: "Team Charlie", slug: "team-charlie", sectionId, createdBy: "seed", updatedBy: "seed" },
			{ name: "Team Delta", slug: "team-delta", sectionId, createdBy: "seed", updatedBy: "seed" },
		])
		.returning()

	const teamAlfa = teams[0]
	const teamBravo = teams[1]
	console.log(`  ✓ ${teams.length} dev teams`)

	// ─── 4. Users + roles + preferences ────────────────────────────────────
	const insertedUsers = await db
		.insert(schema.users)
		.values([
			{ navIdent: "A123456", name: "Kari Nordmann", email: "kari.nordmann@nav.no" },
			{ navIdent: "B654321", name: "Ola Hansen", email: "ola.hansen@nav.no" },
			{ navIdent: "C111111", name: "Per Pedersen", email: "per.pedersen@nav.no" },
			{ navIdent: "D222222", name: "Lise Lund", email: "lise.lund@nav.no" },
		])
		.returning()

	const [kari, ola, per, lise] = insertedUsers

	const insertedUserRoles = await db
		.insert(schema.userRoles)
		.values([
			{ userId: kari.id, role: "admin", createdBy: "seed" },
			{ userId: ola.id, role: "section_manager", sectionId, createdBy: "seed" },
			{ userId: per.id, role: "tech_lead", sectionId, devTeamId: teamAlfa.id, createdBy: "seed" },
			{ userId: lise.id, role: "developer", sectionId, devTeamId: teamBravo.id, createdBy: "seed" },
			{ userId: kari.id, role: "auditor", createdBy: "seed" },
		])
		.returning()

	const perTechLeadRole = insertedUserRoles.find((r) => r.userId === per.id && r.role === "tech_lead")
	if (!perTechLeadRole) throw new Error("Seed: perTechLeadRole not found")

	await db.insert(schema.userPreferences).values([
		{ navIdent: "A123456", landingPage: "dashboard" },
		{ navIdent: "B654321", landingPage: "min-seksjon" },
		{ navIdent: "C111111", landingPage: "mine-team" },
	])

	console.log(`  ✓ ${insertedUsers.length} users + roles + preferences`)

	// ─── 5. Nais teams + discovered apps + dev↔nais mapping ────────────────
	const naisTeams = await db
		.insert(schema.naisTeams)
		.values([
			{
				slug: "team-pensjon",
				displayName: "Team Pensjon",
				appCount: 3,
				status: "monitored",
				sectionId,
				devTeamId: teamAlfa.id,
				discoveredAt: new Date("2026-03-01"),
				reviewedAt: new Date("2026-03-02"),
				reviewedBy: "seed",
			},
			{
				slug: "team-arbeid",
				displayName: "Team Arbeid",
				appCount: 1,
				status: "monitored",
				sectionId,
				devTeamId: teamBravo.id,
				discoveredAt: new Date("2026-03-01"),
			},
			{ slug: "team-helserefusjon", appCount: 0, status: "pending", discoveredAt: new Date("2026-03-28") },
			{
				slug: "team-deploy",
				appCount: 0,
				status: "ignored",
				discoveredAt: new Date("2026-03-15"),
				reviewedBy: "seed",
				reviewedAt: new Date("2026-03-16"),
			},
		])
		.returning()

	const naisPensjon = naisTeams[0]
	const naisArbeid = naisTeams[1]

	await db.insert(schema.devTeamNaisTeamMappings).values([
		{ devTeamId: teamAlfa.id, naisTeamId: naisPensjon.id, createdBy: "seed" },
		{ devTeamId: teamBravo.id, naisTeamId: naisArbeid.id, createdBy: "seed" },
	])

	const discoveredApps = await db
		.insert(schema.naisDiscoveredApps)
		.values([
			{ name: "pensjon-regler", naisTeamId: naisPensjon.id },
			{ name: "pensjon-kalkulator", naisTeamId: naisPensjon.id },
			{ name: "pensjon-frontend", naisTeamId: naisPensjon.id },
			{ name: "arbeid-api", naisTeamId: naisArbeid.id },
		])
		.returning()

	console.log(`  ✓ ${naisTeams.length} nais teams, ${discoveredApps.length} discovered apps`)

	// ─── 6. Monitored applications ─────────────────────────────────────────
	const apps = await db
		.insert(schema.monitoredApplications)
		.values([
			{ name: "pensjon-regler", description: "Regelmotor for pensjon", createdBy: "seed", updatedBy: "seed" },
			{
				name: "pensjon-kalkulator",
				description: "Kalkulator-tjeneste for pensjonsutregning",
				createdBy: "seed",
				updatedBy: "seed",
			},
			{ name: "pensjon-frontend", description: "Web-frontend for pensjon", createdBy: "seed", updatedBy: "seed" },
			{ name: "arbeid-api", description: "API for arbeidsdata", createdBy: "seed", updatedBy: "seed" },
			{
				name: "helserefusjon-web",
				description: "Helserefusjon brukergrensesnitt",
				addedManually: true,
				createdBy: "seed",
				updatedBy: "seed",
			},
		])
		.returning()

	const [appRegler, appKalkulator, appFrontend, appArbeid, appHelse] = apps

	// Primary linking: kalkulator er sekundær til regler
	await db
		.update(schema.monitoredApplications)
		.set({ primaryApplicationId: appRegler.id, updatedBy: "seed" })
		.where(eq(schema.monitoredApplications.id, appKalkulator.id))

	// Application ↔ team mappings
	await db.insert(schema.applicationTeamMappings).values([
		{ applicationId: appRegler.id, devTeamId: teamAlfa.id, createdBy: "seed" },
		{ applicationId: appKalkulator.id, devTeamId: teamAlfa.id, createdBy: "seed" },
		{ applicationId: appFrontend.id, devTeamId: teamAlfa.id, createdBy: "seed" },
		{ applicationId: appArbeid.id, devTeamId: teamBravo.id, createdBy: "seed" },
	])

	// Application environments
	await db.insert(schema.applicationEnvironments).values([
		{
			applicationId: appRegler.id,
			cluster: "prod-gcp",
			namespace: "pensjon",
			imageName: "europe-north1-docker.pkg.dev/nais/pensjon-regler:1.2.3",
			gitRepository: "navikt/pensjon-regler",
			naisTeamId: naisPensjon.id,
		},
		{
			applicationId: appRegler.id,
			cluster: "dev-gcp",
			namespace: "pensjon",
			imageName: "europe-north1-docker.pkg.dev/nais/pensjon-regler:1.2.4-dev",
			gitRepository: "navikt/pensjon-regler",
			naisTeamId: naisPensjon.id,
		},
		{
			applicationId: appKalkulator.id,
			cluster: "prod-gcp",
			namespace: "pensjon",
			gitRepository: "navikt/pensjon-kalkulator",
			naisTeamId: naisPensjon.id,
		},
		{
			applicationId: appArbeid.id,
			cluster: "prod-gcp",
			namespace: "arbeid",
			gitRepository: "navikt/arbeid-api",
			naisTeamId: naisArbeid.id,
		},
	])

	// Application persistence (databaser, buckets, oracle, etc.)
	const persistenceRows = await db
		.insert(schema.applicationPersistence)
		.values([
			{
				applicationId: appRegler.id,
				type: "cloud_sql_postgres",
				name: "pensjon-regler-db",
				version: "16",
				tier: "db-custom-1-3840",
				highAvailability: true,
				auditLogging: true,
				dataClassification: "financial_regulation",
			},
			{
				applicationId: appRegler.id,
				type: "bucket",
				name: "pensjon-regler-attachments",
				dataClassification: "critical",
			},
			{
				applicationId: appKalkulator.id,
				type: "valkey",
				name: "pensjon-kalkulator-cache",
				dataClassification: "not_critical",
			},
			{
				applicationId: appArbeid.id,
				type: "oracle",
				name: "PEN_Q0",
				oracleInstanceId: "pen_q0",
				dataClassification: "financial_regulation",
				auditLogging: true,
				auditLogUrl: "https://oracle-revisjon.example/pen_q0",
			},
			{
				applicationId: appHelse.id,
				type: "opensearch",
				name: "helserefusjon-search",
				manuallyAdded: true,
				dataClassification: "critical",
			},
		])
		.returning()

	// Auth integrations
	await db.insert(schema.applicationAuthIntegrations).values([
		{
			applicationId: appFrontend.id,
			type: "entra_id",
			cluster: "prod-gcp",
			enabled: true,
			allowAllUsers: false,
			groups: JSON.stringify(["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]),
			sidecarEnabled: true,
		},
		{
			applicationId: appRegler.id,
			type: "token_x",
			cluster: "prod-gcp",
			enabled: true,
		},
		{
			applicationId: appArbeid.id,
			type: "maskinporten",
			cluster: "prod-gcp",
			enabled: true,
			claimsExtra: "scope:nav:arbeid:read",
		},
	])

	// Access policy acknowledgments
	await db.insert(schema.accessPolicyAcknowledgments).values({
		applicationId: appRegler.id,
		ruleApplication: "pensjon-frontend",
		comment: "Bekreftet at frontend har lov til å kalle regelmotoren",
		acknowledgedBy: "B654321",
	})

	// Manual groups + group assessments + entra group classifications
	await db.insert(schema.applicationManualGroups).values([
		{
			applicationId: appFrontend.id,
			groupId: "00000000-0000-0000-0000-000000000001",
			groupName: "pensjon-saksbehandlere",
			createdBy: "seed",
		},
		{
			applicationId: appFrontend.id,
			groupId: "00000000-0000-0000-0000-000000000002",
			groupName: "pensjon-lesetilgang",
			createdBy: "seed",
		},
	])

	await db.insert(schema.applicationGroupAssessments).values([
		{
			applicationId: appFrontend.id,
			groupId: "00000000-0000-0000-0000-000000000001",
			criticality: "high",
			assessedBy: "seed",
			updatedBy: "seed",
		},
		{
			applicationId: appFrontend.id,
			groupId: "00000000-0000-0000-0000-000000000002",
			criticality: "low",
			assessedBy: "seed",
			updatedBy: "seed",
		},
	])

	await db.insert(schema.entraGroupClassifications).values([
		{
			groupId: "00000000-0000-0000-0000-000000000001",
			classification: "mine_tilganger",
			createdBy: "seed",
			updatedBy: "seed",
		},
		{
			groupId: "00000000-0000-0000-0000-000000000002",
			classification: "identrutina",
			createdBy: "seed",
			updatedBy: "seed",
		},
	])

	// Link suggestions
	await db.insert(schema.linkSuggestions).values({
		primaryAppId: appRegler.id,
		secondaryAppId: appKalkulator.id,
		matchType: "name_pattern",
		confidence: "high",
		status: "pending",
	})

	console.log(`  ✓ ${apps.length} applications + environments + persistence + auth + grupper`)

	// ─── 7. Framework version + domains + risks + controls ────────────────
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

	const domainMap = Object.fromEntries(domains.map((d) => [d.code, d.id]))

	const riskControlData: Array<{
		domainCode: string
		riskId: string
		riskDesc: string
		controls: Array<{
			controlId: string
			name: string
			frequency?: string
			cronFrequency?: string
			documentation?: string
		}>
	}> = [
		{
			domainCode: "ST",
			riskId: "R-ST.01",
			riskDesc: "Mangelfull styring av IT-sikkerhet og kontrollmiljø",
			controls: [
				{
					controlId: "K-ST.01",
					name: "Etablert sikkerhetspolicy og styringsrammeverk",
					frequency: "Årlig",
					cronFrequency: "annual",
					documentation: "Godkjent og publisert sikkerhetspolicy",
				},
			],
		},
		{
			domainCode: "ST",
			riskId: "R-ST.02",
			riskDesc: "Mangelfull risikovurdering og oppfølging",
			controls: [
				{
					controlId: "K-ST.02",
					name: "Periodisk risikovurdering og oppfølging",
					frequency: "Halvårlig",
					cronFrequency: "biannual",
				},
			],
		},
		{
			domainCode: "TS",
			riskId: "R-TS.01",
			riskDesc: "Uautorisert tilgang til systemer og data",
			controls: [
				{
					controlId: "K-TS.01",
					name: "Tilgangspolicy og rollebasert tilgangskontroll",
					frequency: "Kvartalsvis",
					cronFrequency: "quarterly",
				},
				{ controlId: "K-TS.02", name: "Brukeropprettelse og godkjenning" },
				{
					controlId: "K-TS.03",
					name: "Periodisk gjennomgang av tilganger",
					frequency: "Kvartalsvis",
					cronFrequency: "quarterly",
				},
				{ controlId: "K-TS.04", name: "Fjerning av tilganger ved endring/avslutning" },
				{ controlId: "K-TS.05", name: "Privilegert tilgangsstyring", frequency: "Månedlig" },
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
			controls: [
				{
					controlId: "K-DR.01",
					name: "Sikkerhetskopiering og gjenopprettingstesting",
					frequency: "Månedlig",
					cronFrequency: "monthly",
				},
			],
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
					controlId: ctrl.controlId,
					shortTitle: ctrl.name,
					technologyElement: ctrl.controlId === "K-ST.01" ? "Styringsverktøy, dokumenthåndteringssystem" : null,
					requirement:
						ctrl.controlId === "K-ST.01"
							? "Organisasjonen skal ha en dokumentert og godkjent IT-sikkerhetspolicy"
							: null,
					frequency: ctrl.frequency,
					cronFrequency: ctrl.cronFrequency,
					documentationRequirement: ctrl.documentation,
					responsible: "Teknologileder",
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

	// Control dependency: K-TS.03 (gjennomgang) avhenger av K-TS.01 (policy)
	await db.insert(schema.controlDependencies).values({
		controlId: controlUuidMap["K-TS.03"],
		dependsOnControlId: controlUuidMap["K-TS.01"],
	})

	// Predefined answers for et utvalg kontroller
	await db.insert(schema.controlPredefinedAnswers).values([
		{
			controlId: controlUuidMap["K-TS.01"],
			label: "Bruker felles tilgangsmal",
			status: "implemented",
			comment: "Standard mal definert i konsernpolicy",
			displayOrder: 1,
			createdBy: "seed",
			updatedBy: "seed",
		},
		{
			controlId: controlUuidMap["K-EH.04"],
			label: "Bygges via GitHub Actions",
			status: "implemented",
			displayOrder: 1,
			createdBy: "seed",
			updatedBy: "seed",
		},
	])

	console.log(`  ✓ ${riskCount} risks, ${controlCount} controls`)

	// ─── 8. Technology elements ────────────────────────────────────────────
	const techElements = await db
		.insert(schema.technologyElements)
		.values([
			{ name: "PostgreSQL", slug: "postgresql", description: "Relasjonsdatabase", displayOrder: 1 },
			{ name: "Oracle", slug: "oracle", description: "Oracle-database", displayOrder: 2 },
			{ name: "GCS Bucket", slug: "gcs-bucket", description: "Object storage", displayOrder: 3 },
			{ name: "Entra ID", slug: "entra-id", description: "Identitetsplattform", displayOrder: 4 },
			{ name: "GitHub Actions", slug: "github-actions", description: "CI/CD", displayOrder: 5 },
			{ name: "OpenSearch", slug: "opensearch", description: "Søkeindeks", displayOrder: 6 },
		])
		.returning()

	const elementMap = Object.fromEntries(techElements.map((e) => [e.slug, e.id]))

	await db.insert(schema.controlTechnologyElements).values([
		{ controlId: controlUuidMap["K-TS.01"], elementId: elementMap["entra-id"] },
		{ controlId: controlUuidMap["K-TS.03"], elementId: elementMap["entra-id"] },
		{ controlId: controlUuidMap["K-TS.05"], elementId: elementMap.oracle },
		{ controlId: controlUuidMap["K-EH.04"], elementId: elementMap["github-actions"] },
		{ controlId: controlUuidMap["K-DR.01"], elementId: elementMap.postgresql },
		{ controlId: controlUuidMap["K-DR.01"], elementId: elementMap["gcs-bucket"] },
	])

	await db.insert(schema.applicationTechnologyElements).values([
		{
			applicationId: appRegler.id,
			elementId: elementMap.postgresql,
			source: "auto",
			confirmedBy: "seed",
			confirmedAt: new Date(),
		},
		{
			applicationId: appRegler.id,
			elementId: elementMap["github-actions"],
			source: "auto",
			confirmedBy: "seed",
			confirmedAt: new Date(),
		},
		{
			applicationId: appFrontend.id,
			elementId: elementMap["entra-id"],
			source: "manual",
			confirmedBy: "seed",
			confirmedAt: new Date(),
		},
		{
			applicationId: appArbeid.id,
			elementId: elementMap.oracle,
			source: "auto",
			confirmedBy: "seed",
			confirmedAt: new Date(),
		},
		{
			applicationId: appHelse.id,
			elementId: elementMap.opensearch,
			source: "manual",
			confirmedBy: "seed",
			confirmedAt: new Date(),
		},
	])

	console.log(`  ✓ ${techElements.length} technology elements + mappings`)

	// ─── 9. Rulesets (må finnes før screening_questions kan linke til dem) ─
	const [ruleset] = await db
		.insert(schema.rulesets)
		.values({
			sectionId,
			code: "RS-001",
			name: "Standard regelsett for utviklingsteam",
			description: "Basis regelsett for alle pensjonsapplikasjoner",
			responsibleIdent: "B654321",
			responsibleName: "Ola Hansen",
			responsibleRole: "Seksjonsleder",
			frequency: "quarterly",
			status: "active",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	const [draftRuleset] = await db
		.insert(schema.rulesets)
		.values({
			sectionId,
			code: "RS-002",
			name: "Regelsett for kritiske finansielle systemer",
			frequency: "monthly",
			status: "draft",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	await db.insert(schema.rulesetApprovals).values({
		rulesetId: ruleset.id,
		approvedBy: "B654321",
		approvedByName: "Ola Hansen",
		comment: "Godkjent av seksjonsleder",
		validFrom: new Date("2026-01-01"),
		validUntil: new Date("2026-12-31"),
	})

	await db.insert(schema.rulesetControls).values([
		{ rulesetId: ruleset.id, controlId: controlUuidMap["K-TS.01"] },
		{ rulesetId: ruleset.id, controlId: controlUuidMap["K-TS.03"] },
		{ rulesetId: ruleset.id, controlId: controlUuidMap["K-EH.04"] },
		{ rulesetId: draftRuleset.id, controlId: controlUuidMap["K-DR.01"] },
	])

	await db.insert(schema.rulesetAttachments).values({
		rulesetId: ruleset.id,
		fileName: "regelsett-vedlegg.pdf",
		bucketPath: "ruleset-attachments/rs-001/regelsett-vedlegg.pdf",
		contentType: "application/pdf",
		sizeBytes: 12345,
		uploadedBy: "seed",
	})

	console.log(`  ✓ 2 rulesets`)

	// ─── 10. Screening questions, choices, effects, answers ────────────────
	const [questionCritical] = await db
		.insert(schema.screeningQuestions)
		.values({
			sectionId,
			rulesetId: ruleset.id,
			questionText: "Behandler applikasjonen kritiske data underlagt økonomireglementet?",
			description: "Brukes for å avgjøre hvilke kontroller som er aktuelle.",
			answerType: "boolean",
			displayOrder: 1,
			status: "approved",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	const [questionRoutine] = await db
		.insert(schema.screeningQuestions)
		.values({
			sectionId,
			questionText: "Hvilken rutine bruker dere for tilgangsgjennomgang?",
			answerType: "single_choice",
			displayOrder: 2,
			status: "approved",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	const [questionDraft] = await db
		.insert(schema.screeningQuestions)
		.values({
			sectionId,
			questionText: "Bruker applikasjonen Entra ID for autentisering?",
			answerType: "boolean",
			displayOrder: 3,
			status: "draft",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	// Choices for ja/nei på kritisk-spørsmålet
	const choicesCritical = await db
		.insert(schema.screeningQuestionChoices)
		.values([
			{ questionId: questionCritical.id, label: "Ja", displayOrder: 1 },
			{ questionId: questionCritical.id, label: "Nei", displayOrder: 2, requiresComment: true },
		])
		.returning()

	const choicesRoutine = await db
		.insert(schema.screeningQuestionChoices)
		.values([
			{ questionId: questionRoutine.id, label: "Standardrutine", displayOrder: 1 },
			{ questionId: questionRoutine.id, label: "Egen rutine", displayOrder: 2, requiresLink: true },
		])
		.returning()

	const choiceEffects = await db
		.insert(schema.screeningChoiceEffects)
		.values([
			{
				choiceId: choicesCritical[0].id,
				controlId: controlUuidMap["K-TS.05"],
				effect: "implemented",
				comment: "Privilegert tilgang gjelder",
			},
			{
				choiceId: choicesCritical[1].id,
				controlId: controlUuidMap["K-TS.05"],
				effect: "not_relevant",
				comment: "Ikke kritisk – privilegert tilgang ikke aktuelt",
			},
			{
				choiceId: choicesRoutine[0].id,
				controlId: controlUuidMap["K-TS.03"],
				effect: "select_routine",
			},
		])
		.returning()

	await db
		.insert(schema.screeningQuestionTechnologyElements)
		.values([{ questionId: questionDraft.id, elementId: elementMap["entra-id"] }])

	await db.insert(schema.screeningAnswers).values([
		{
			applicationId: appRegler.id,
			questionId: questionCritical.id,
			answer: "Ja",
			answeredBy: "B654321",
			answeredAt: new Date(),
		},
		{
			applicationId: appKalkulator.id,
			questionId: questionCritical.id,
			answer: "Nei",
			comment: "Kun avledet kalkulator-data",
			answeredBy: "C111111",
			answeredAt: new Date(),
		},
		{
			applicationId: appRegler.id,
			questionId: questionRoutine.id,
			answer: "Standardrutine",
			answeredBy: "B654321",
			answeredAt: new Date(),
		},
	])

	console.log(`  ✓ 3 screening questions + choices/effects/answers`)

	// ─── 10b. Globale innledende spørsmål (admin-nivå, sectionId = null) ──
	const [globalQDataclass] = await db
		.insert(schema.screeningQuestions)
		.values({
			sectionId: null,
			questionText: "Behandler applikasjonen personopplysninger?",
			description: "Globalt innledende spørsmål som gjelder alle seksjoner.",
			answerType: "single_choice",
			displayOrder: 1,
			status: "approved",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	const [globalQHosting] = await db
		.insert(schema.screeningQuestions)
		.values({
			sectionId: null,
			questionText: "Hvor er applikasjonen hostet?",
			description: "Brukes for å avgjøre hvilke driftskontroller som er aktuelle.",
			answerType: "single_choice",
			displayOrder: 2,
			status: "approved",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	const [globalQCritical] = await db
		.insert(schema.screeningQuestions)
		.values({
			sectionId: null,
			questionText: "Er applikasjonen virksomhetskritisk?",
			answerType: "boolean",
			displayOrder: 3,
			status: "ready",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	const globalDataclassChoices = await db
		.insert(schema.screeningQuestionChoices)
		.values([
			{ questionId: globalQDataclass.id, label: "Ja, sensitive personopplysninger", displayOrder: 1 },
			{ questionId: globalQDataclass.id, label: "Ja, ordinære personopplysninger", displayOrder: 2 },
			{ questionId: globalQDataclass.id, label: "Nei", displayOrder: 3, requiresComment: true },
		])
		.returning()

	const globalHostingChoices = await db
		.insert(schema.screeningQuestionChoices)
		.values([
			{ questionId: globalQHosting.id, label: "Nais (GCP)", displayOrder: 1 },
			{ questionId: globalQHosting.id, label: "On-prem", displayOrder: 2 },
			{ questionId: globalQHosting.id, label: "SaaS", displayOrder: 3, requiresLink: true },
		])
		.returning()

	const globalCriticalChoices = await db
		.insert(schema.screeningQuestionChoices)
		.values([
			{ questionId: globalQCritical.id, label: "Ja", displayOrder: 1 },
			{ questionId: globalQCritical.id, label: "Nei", displayOrder: 2 },
		])
		.returning()

	await db.insert(schema.screeningChoiceEffects).values([
		{
			choiceId: globalDataclassChoices[0].id,
			controlId: controlUuidMap["K-TS.01"],
			effect: "implemented",
			comment: "Sensitive personopplysninger krever streng tilgangskontroll",
		},
		{
			choiceId: globalDataclassChoices[2].id,
			controlId: controlUuidMap["K-TS.01"],
			effect: "not_relevant",
		},
		{
			choiceId: globalHostingChoices[0].id,
			controlId: controlUuidMap["K-EH.04"],
			effect: "implemented",
			comment: "Nais-plattformen håndhever automatisert pipeline",
		},
		{
			choiceId: globalCriticalChoices[0].id,
			controlId: controlUuidMap["K-DR.01"],
			effect: "implemented",
		},
	])

	await db.insert(schema.screeningAnswers).values([
		{
			applicationId: appRegler.id,
			questionId: globalQDataclass.id,
			answer: "Ja, sensitive personopplysninger",
			answeredBy: "B654321",
			answeredAt: new Date(),
		},
		{
			applicationId: appRegler.id,
			questionId: globalQHosting.id,
			answer: "Nais (GCP)",
			answeredBy: "B654321",
			answeredAt: new Date(),
		},
		{
			applicationId: appRegler.id,
			questionId: globalQCritical.id,
			answer: "Ja",
			answeredBy: "B654321",
			answeredAt: new Date(),
		},
		{
			applicationId: appKalkulator.id,
			questionId: globalQHosting.id,
			answer: "Nais (GCP)",
			answeredBy: "C111111",
			answeredAt: new Date(),
		},
	])

	console.log(`  ✓ 3 globale innledende spørsmål + choices/effects/answers`)

	// ─── 11. Routines + alle link-tabeller + reviews ───────────────────────
	const [routineTilgang] = await db
		.insert(schema.routines)
		.values({
			sectionId,
			name: "Kvartalsvis tilgangsgjennomgang",
			description: "Gjennomgang av Entra ID-grupper og roller hvert kvartal",
			frequency: "quarterly",
			responsibleRole: "tech_lead",
			appliesToAllInSection: 1,
			screeningQuestionId: questionRoutine.id,
			screeningChoiceValue: "Standardrutine",
			status: "approved",
			approvedBy: "B654321",
			approvedAt: new Date(),
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	const [routineBackup] = await db
		.insert(schema.routines)
		.values({
			sectionId,
			name: "Månedlig backup-test",
			description: "Test av gjenoppretting fra backup",
			frequency: "monthly",
			responsibleRole: "developer",
			status: "ready",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	const [routineDraft] = await db
		.insert(schema.routines)
		.values({
			sectionId,
			name: "Halvårlig sikkerhetspolicy-gjennomgang",
			frequency: "semi_annually",
			status: "draft",
			createdBy: "seed",
			updatedBy: "seed",
		})
		.returning()

	await db.insert(schema.routineControls).values([
		{ routineId: routineTilgang.id, controlId: controlUuidMap["K-TS.01"] },
		{ routineId: routineTilgang.id, controlId: controlUuidMap["K-TS.03"] },
		{ routineId: routineBackup.id, controlId: controlUuidMap["K-DR.01"] },
		{ routineId: routineDraft.id, controlId: controlUuidMap["K-ST.01"] },
	])

	await db
		.insert(schema.routineActivityLinks)
		.values([
			{ routineId: routineTilgang.id, activityType: "entra_id_group_maintenance", sortOrder: 0, createdBy: "seed" },
		])

	await db.insert(schema.routineTechnologyElements).values([
		{ routineId: routineTilgang.id, elementId: elementMap["entra-id"] },
		{ routineId: routineBackup.id, elementId: elementMap.postgresql },
		{ routineId: routineBackup.id, elementId: elementMap["gcs-bucket"] },
	])

	await db.insert(schema.routinePersistenceLinks).values([
		{ routineId: routineBackup.id, persistenceType: "cloud_sql_postgres", dataClassification: "financial_regulation" },
		{ routineId: routineBackup.id, persistenceType: "bucket", dataClassification: "critical" },
	])

	await db.insert(schema.routineGroupClassificationLinks).values([
		{ routineId: routineTilgang.id, classification: "mine_tilganger" },
		{ routineId: routineTilgang.id, classification: "identrutina" },
	])

	await db.insert(schema.routineOracleRoleCriticalityLinks).values([
		{ routineId: routineTilgang.id, criticality: "high" },
		{ routineId: routineTilgang.id, criticality: "very_high" },
	])

	await db.insert(schema.routineScreeningQuestions).values({
		routineId: routineTilgang.id,
		questionId: questionRoutine.id,
		choiceValue: "Standardrutine",
	})

	// Connect routine to ruleset
	await db.insert(schema.rulesetRoutines).values([
		{ rulesetId: ruleset.id, routineId: routineTilgang.id, createdBy: "seed" },
		{ rulesetId: ruleset.id, routineId: routineBackup.id, createdBy: "seed" },
	])

	// Connect screening routine selection
	await db.insert(schema.screeningRoutineSelections).values({
		applicationId: appRegler.id,
		choiceEffectId: choiceEffects[2].id,
		routineId: routineTilgang.id,
		selectedBy: "B654321",
	})

	// Routine reviews
	const [reviewCompleted] = await db
		.insert(schema.routineReviews)
		.values({
			routineId: routineTilgang.id,
			applicationId: appRegler.id,
			title: "Q1 2026 tilgangsgjennomgang",
			summary: "Gjennomgått alle pensjon-grupper. Fjernet 3 inaktive brukere.",
			routineSnapshotPath: "routine-snapshots/tilgang-q1-2026.json",
			status: "completed",
			reviewedAt: new Date("2026-03-15"),
			createdBy: "C111111",
		})
		.returning()

	const [reviewDraft] = await db
		.insert(schema.routineReviews)
		.values({
			routineId: routineBackup.id,
			applicationId: appRegler.id,
			title: "April 2026 backup-test",
			status: "draft",
			reviewedAt: new Date("2026-04-10"),
			createdBy: "D222222",
		})
		.returning()

	await db.insert(schema.routineReviewParticipants).values([
		{ reviewId: reviewCompleted.id, userIdent: "B654321", userName: "Ola Hansen", confirmedAt: new Date() },
		{ reviewId: reviewCompleted.id, userIdent: "C111111", userName: "Per Pedersen", confirmedAt: new Date() },
		{ reviewId: reviewDraft.id, userIdent: "D222222", userName: "Lise Lund" },
	])

	await db.insert(schema.routineReviewAttachments).values({
		reviewId: reviewCompleted.id,
		fileName: "tilgangsgjennomgang-q1.xlsx",
		bucketPath: "review-attachments/tilgang-q1-2026.xlsx",
		contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		sizeBytes: 45678,
		uploadedBy: "C111111",
	})

	await db.insert(schema.routineReviewLinks).values({
		reviewId: reviewCompleted.id,
		url: "https://confluence.example/pensjon/tilgangsgjennomgang-q1-2026",
		title: "Confluence-side med detaljert dokumentasjon",
		addedBy: "C111111",
	})

	const [activity] = await db
		.insert(schema.routineReviewActivities)
		.values({
			reviewId: reviewCompleted.id,
			type: "entra_id_group_maintenance",
			status: "completed",
			snapshotBefore: { groupCount: 5, memberCount: 42 },
			snapshotAfter: { groupCount: 5, memberCount: 39 },
			completedAt: new Date("2026-03-15"),
		})
		.returning()

	await db.insert(schema.routineReviewActivityEntraChanges).values([
		{
			activityId: activity.id,
			changeType: "removed",
			groupId: "00000000-0000-0000-0000-000000000001",
			groupName: "pensjon-saksbehandlere",
			previousValue: "anders.andersen@nav.no",
			performedBy: "C111111",
		},
		{
			activityId: activity.id,
			changeType: "criticality_changed",
			groupId: "00000000-0000-0000-0000-000000000002",
			groupName: "pensjon-lesetilgang",
			previousValue: "low",
			newValue: "medium",
			performedBy: "C111111",
		},
	])

	console.log(`  ✓ 3 routines + reviews + activities`)

	// ─── 12. Application controls (cache) ──────────────────────────────────
	const appControls = await db
		.insert(schema.applicationControls)
		.values([
			{
				applicationId: appRegler.id,
				controlId: controlUuidMap["K-TS.01"],
				status: "implemented",
				autoReason: "Etablert via standardrutine",
				establishment: "established",
				routineCompliance: "completed",
				routinesEstablished: 1,
				routinesCompleted: 1,
				matchSources: ["screening", "ruleset"],
				matchingRoutineIds: [routineTilgang.id],
				createdBy: "seed",
				updatedBy: "seed",
			},
			{
				applicationId: appRegler.id,
				controlId: controlUuidMap["K-TS.03"],
				status: "implemented",
				establishment: "established",
				routineCompliance: "completed",
				routinesEstablished: 1,
				routinesCompleted: 1,
				matchSources: ["screening"],
				matchingRoutineIds: [routineTilgang.id],
				createdBy: "seed",
				updatedBy: "seed",
			},
			{
				applicationId: appRegler.id,
				controlId: controlUuidMap["K-DR.01"],
				status: "partially_implemented",
				autoReason: "Rutine etablert, men ikke gjennomført siste periode",
				establishment: "established",
				routineCompliance: "overdue",
				routinesEstablished: 1,
				routinesOverdue: 1,
				matchSources: ["ruleset"],
				matchingRoutineIds: [routineBackup.id],
				comment: "Backup-test ble utsatt pga. infrastruktur-vedlikehold",
				commentUpdatedAt: new Date(),
				commentUpdatedBy: "B654321",
				createdBy: "seed",
				updatedBy: "seed",
			},
			{
				applicationId: appKalkulator.id,
				controlId: controlUuidMap["K-TS.05"],
				status: "not_relevant",
				autoReason: "Markert som ikke kritisk i screening",
				establishment: "not_relevant",
				routineCompliance: "not_applicable",
				matchSources: ["screening"],
				createdBy: "seed",
				updatedBy: "seed",
			},
		])
		.returning()

	await db.insert(schema.applicationControlHistory).values([
		{
			applicationControlId: appControls[0].id,
			action: "activated",
			newStatus: "implemented",
			reason: "Aktivert via screening",
			performedBy: "seed",
		},
		{
			applicationControlId: appControls[2].id,
			action: "status_changed",
			previousStatus: "implemented",
			newStatus: "partially_implemented",
			reason: "Backup-test forfalt",
			performedBy: "B654321",
		},
		{
			applicationControlId: appControls[2].id,
			action: "comment_changed",
			newComment: "Backup-test ble utsatt pga. infrastruktur-vedlikehold",
			performedBy: "B654321",
		},
	])

	console.log(`  ✓ ${appControls.length} application controls + history`)

	// ─── 13. Oracle instances + role assessments + audit evidence ──────────
	await db.insert(schema.applicationOracleInstances).values({
		applicationId: appArbeid.id,
		instanceId: "pen_q0",
		includeInReport: true,
		configuredBy: "seed",
	})

	await db.insert(schema.oracleRoleAssessments).values([
		{
			applicationId: appArbeid.id,
			instanceId: "pen_q0",
			roleName: "APP_USER",
			criticality: "very_high",
			assessedBy: "seed",
			updatedBy: "seed",
			createdBy: "seed",
		},
		{
			applicationId: appArbeid.id,
			instanceId: "pen_q0",
			roleName: "BATCH_ROLE",
			criticality: "low",
			assessedBy: "seed",
			updatedBy: "seed",
			createdBy: "seed",
		},
	])

	await db.insert(schema.auditEvidenceSnapshots).values({
		applicationId: appArbeid.id,
		instanceId: "pen_q0",
		overallStatus: "OK",
		collectedAt: new Date("2026-04-01"),
		fetchedBy: "seed",
		bucketPath: "audit-evidence/pen_q0/2026-04-01.json",
	})

	const oraclePersistence = persistenceRows.find((p) => p.type === "oracle")
	if (oraclePersistence) {
		await db.insert(schema.persistenceAuditSummaries).values({
			persistenceId: oraclePersistence.id,
			conclusion: "FULLSTENDIG",
			reason: "Unified auditing aktivert med 12 policyer",
			unifiedAuditingEnabled: true,
			activePolicyCount: 12,
			auditedObjectCount: 145,
			unauditedTableCount: 0,
			excludedUserCount: 2,
			policiesWithoutFailureAudit: 0,
			hasAuditTrailData: true,
			findings: [{ severity: "info", message: "Alle nødvendige tabeller dekket" }],
			fetchedAt: new Date(),
			createdBy: "seed",
			updatedBy: "seed",
		})
	}

	const pgPersistence = persistenceRows.find((p) => p.type === "cloud_sql_postgres")
	if (pgPersistence) {
		await db.insert(schema.persistenceAuditConfirmations).values({
			persistenceId: pgPersistence.id,
			enabledAt: "2026-01-15",
			description: "Audit logging aktivert via pgaudit-extension",
			evidenceUrl: "https://console.cloud.google.com/sql/audit",
			confirmedBy: "B654321",
			createdBy: "seed",
			updatedBy: "seed",
		})
	}

	console.log(`  ✓ oracle/postgres audit-evidence`)

	// ─── 14. Deployment verification ───────────────────────────────────────
	await db.insert(schema.deploymentVerificationSummaries).values({
		applicationId: appRegler.id,
		environment: "prod-gcp",
		teamSlug: "team-pensjon",
		appName: "pensjon-regler",
		periodFrom: new Date("2026-01-01"),
		periodTo: new Date("2026-03-31"),
		fourEyesCoveragePercent: 96,
		fourEyesTotal: 25,
		fourEyesApproved: 24,
		changeOriginCoveragePercent: 92,
		changeOriginTotal: 25,
		changeOriginLinked: 23,
		lastDeploymentAt: new Date("2026-03-30"),
		rawSummary: {
			app: { team: "team-pensjon", environment: "prod-gcp", name: "pensjon-regler", isActive: true },
			period: { from: "2026-01-01", to: "2026-03-31" },
			fourEyesCoverage: { total: 25, approved: 24, unapproved: 1, pending: 0, coveragePercent: 96 },
			changeOriginCoverage: { total: 25, linked: 23, dependabot: 5, coveragePercent: 92 },
			lastDeployment: {
				createdAt: "2026-03-30T10:15:00Z",
				deployer: "C111111",
				commitSha: "abc1234",
				fourEyesStatus: "approved",
				hasChangeOrigin: true,
			},
		},
		status: "synced",
		fetchedAt: new Date(),
		createdBy: "seed",
		updatedBy: "seed",
	})

	console.log(`  ✓ deployment verification summary`)

	// ─── 15. Documents + bucket objects + reports ──────────────────────────
	await db.insert(schema.documents).values([
		{
			title: "Sikkerhetspolicy 2026",
			description: "Konsernpolicy for IT-sikkerhet",
			originalFileName: "sikkerhetspolicy-2026.pdf",
			contentType: "application/pdf",
			sizeBytes: 234567,
			bucketPath: "documents/sikkerhetspolicy-2026.pdf",
			uploadedBy: "A123456",
		},
		{
			title: "Rutinemal for tilgangsgjennomgang",
			originalFileName: "rutinemal-tilgang.docx",
			contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			sizeBytes: 45678,
			bucketPath: "documents/rutinemal-tilgang.docx",
			uploadedBy: "B654321",
		},
	])

	await db.insert(schema.bucketObjects).values([
		{
			bucketName: "kiss-prod",
			objectPath: "framework-uploads/mkr-v1.1.xlsx",
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			sizeBytes: 98765,
			objectType: "framework_import",
			uploadedBy: "A123456",
		},
		{
			bucketName: "kiss-prod",
			objectPath: "review-attachments/tilgang-q1-2026.xlsx",
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			sizeBytes: 45678,
			objectType: "review_attachment",
			uploadedBy: "C111111",
		},
	])

	const insertedReports = await db
		.insert(schema.reports)
		.values([
			{
				name: "Compliance-rapport pensjon-regler Q1 2026",
				reportType: "application_compliance",
				scope: "application",
				scopeId: appRegler.id,
				snapshotBucketPath: "reports/snapshots/pensjon-regler-q1-2026.json",
				reportBucketPath: "reports/pdf/pensjon-regler-q1-2026.pdf",
				appVersion: "1.0.0",
				createdBy: "B654321",
			},
			{
				name: "Seksjonsrapport Utvikling Q1 2026",
				reportType: "section_summary",
				scope: "section",
				scopeId: sectionId,
				snapshotBucketPath: "reports/snapshots/utvikling-q1-2026.json",
				appVersion: "1.0.0",
				createdBy: "B654321",
			},
		])
		.returning()

	const reportPensjon = insertedReports[0]

	console.log(`  ✓ documents, bucket objects, reports`)

	// ─── 16. Audit log entries ─────────────────────────────────────────────
	await db.insert(schema.auditLog).values([
		{
			action: "section_created",
			entityType: "section",
			entityId: sectionId,
			newValue: "Utvikling",
			performedBy: "seed",
		},
		{
			action: "team_created",
			entityType: "team",
			entityId: teamAlfa.id,
			newValue: "Team Alfa",
			metadata: JSON.stringify({ sectionId, slug: teamAlfa.slug, description: teamAlfa.description }),
			performedBy: "seed",
		},
		{
			action: "framework_imported",
			entityType: "framework_version",
			entityId: fwVersion.id,
			newValue: "Minimum kontrollrammeverk (v1.1)",
			performedBy: "seed",
		},
		{
			action: "framework_activated",
			entityType: "framework_version",
			entityId: fwVersion.id,
			performedBy: "seed",
		},
		{
			action: "routine_created",
			entityType: "routine",
			entityId: routineTilgang.id,
			newValue: "Kvartalsvis tilgangsgjennomgang",
			performedBy: "seed",
		},
		{
			action: "routine_approved",
			entityType: "routine",
			entityId: routineTilgang.id,
			performedBy: "B654321",
		},
		{
			action: "routine_review_completed",
			entityType: "routine_review",
			entityId: reviewCompleted.id,
			newValue: "completed",
			performedBy: "C111111",
		},
		{
			action: "screening_answer_saved",
			entityType: "screening_answer",
			entityId: `${appRegler.id}/${questionCritical.id}`,
			newValue: "Ja",
			performedBy: "B654321",
		},
		{
			action: "user_role_granted",
			entityType: "user_role",
			entityId: perTechLeadRole.id,
			newValue: JSON.stringify({
				navIdent: "C111111",
				role: "tech_lead",
				sectionId,
				devTeamId: teamAlfa.id,
			}),
			performedBy: "seed",
		},
		{
			action: "report_generated",
			entityType: "report",
			entityId: reportPensjon.id,
			newValue: "Compliance-rapport pensjon-regler Q1 2026",
			metadata: JSON.stringify({ scope: "application", scopeId: appRegler.id }),
			performedBy: "B654321",
		},
	])

	console.log(`  ✓ audit log entries`)

	console.log("🌱 Seeding complete!")
	await pool.end()
}

seed().catch((err) => {
	console.error("❌ Seed failed:", err)
	process.exit(1)
})
