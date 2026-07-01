import { BodyShort, VStack } from "@navikt/ds-react"
import { useCallback, useMemo } from "react"
import { data, Link, useLoaderData, useSearchParams } from "react-router"
import type { NdaEvidenceDataProp } from "~/components/evidence/DeploymentEvidenceSection"
import { EvidenceSection } from "~/components/evidence/EvidenceSection"
import type { OracleEvidenceDataProp } from "~/components/evidence/OracleEvidenceSection"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getActivityStepsForRoutine, getRoutine, getRoutineActivityLinks } from "~/db/queries/routines.server"
import { getRulesetsLinkedToControls } from "~/db/queries/rulesets.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import {
	isDeploymentEvidenceActivityType,
	isOracleEvidenceActivityType,
	oracleEvidenceTypesForActivity,
} from "~/lib/activity-types"
import { getAuthenticatedUser } from "~/lib/auth.server"
import type { ComponentConfig, StepComponent } from "~/lib/manual-activity-staged-data"
import { renderMarkdown } from "~/lib/markdown.server"
import type { OracleRoleStagedEntry } from "~/lib/oracle-role-staged-data"
import type { RpaMaintenanceData } from "~/lib/rpa-staged-data"
import {
	EntraMaintenanceSection,
	type EntraStagedGroupsProp,
} from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/activities/EntraMaintenanceSection"
import {
	type OracleRoleCriticalityData,
	OracleRoleCriticalityMaintenanceSection,
} from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/activities/OracleRoleCriticalityMaintenanceSection"
import { RpaUserMaintenanceSection } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/activities/RpaUserMaintenanceSection"
import { FollowUpPointsSection } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/follow-up/FollowUpPointsSection"
import { ReviewWizard } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/ReviewWizard"
import { StepAttachments } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/StepAttachments"
import { StepComplete } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/StepComplete"
import { StepControls } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/StepControls"
import { StepIntroduction } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/StepIntroduction"
import { StepManualActivityItem } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/StepManualActivityItem"
import { StepRoutine } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/StepRoutine"
import { StepRulesets } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/StepRulesets"
import { StepSummary } from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/StepSummary"
import {
	type ActivityStepInfo,
	buildSteps,
	parseActivityStepId,
	parseActivityStepIndex,
} from "../seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/shared"
import type { Route } from "./+types/index"

// ─── Mock data for dynamic activity types ─────────────────────────────────────

const MOCK_ENTRA_GROUPS: EntraStagedGroupsProp = {
	groups: [
		{
			groupId: "00000000-0000-0000-0000-000000000001",
			groupName: "AD_APP_ADMIN (eksempel)",
			source: "nais_auth",
			hasNaisSource: true,
			hasManualSource: false,
			isGone: false,
			isNewAssessment: true,
			isAddedDuringReview: false,
			criticality: null,
		},
		{
			groupId: "00000000-0000-0000-0000-000000000002",
			groupName: "AD_APP_READ (eksempel)",
			source: "nais_auth",
			hasNaisSource: true,
			hasManualSource: false,
			isGone: false,
			isNewAssessment: false,
			isAddedDuringReview: false,
			criticality: "low",
		},
		{
			groupId: "00000000-0000-0000-0000-000000000003",
			groupName: "AD_APP_MANUELL (eksempel)",
			source: "manual",
			hasNaisSource: false,
			hasManualSource: true,
			isGone: true,
			isNewAssessment: false,
			isAddedDuringReview: false,
			criticality: "medium",
		},
	],
}

const MOCK_ORACLE_ROLES: OracleRoleCriticalityData = {
	activityId: "preview",
	apiUnavailable: false,
	roles: [
		{
			instanceId: "DBPROD",
			roleName: "APP_ADMIN_ROLE",
			oracleMaintained: false,
			common: false,
			isNew: true,
			isGone: false,
			criticality: null,
			criticalitySetBy: null,
			criticalitySetAt: null,
		},
		{
			instanceId: "DBPROD",
			roleName: "CONNECT",
			oracleMaintained: true,
			common: true,
			isNew: false,
			isGone: false,
			criticality: "low",
			criticalitySetBy: "Z990001",
			criticalitySetAt: new Date().toISOString(),
		},
		{
			instanceId: "DBPROD",
			roleName: "APP_READ_ROLE",
			oracleMaintained: false,
			common: false,
			isNew: false,
			isGone: true,
			criticality: "medium",
			criticalitySetBy: "Z990001",
			criticalitySetAt: new Date().toISOString(),
		},
	] satisfies OracleRoleStagedEntry[],
}

const MOCK_RPA_DATA: RpaMaintenanceData = {
	users: [
		{
			userObjectId: "preview-rpa-1",
			displayName: "Produktiv Robot (eksempel)",
			userPrincipalName: "srv-robot-app-prod@nav.no",
			accountEnabled: true,
			rpaGroupName: "RPA_APP_PROD",
			matchSource: "nais",
		},
		{
			userObjectId: "preview-rpa-2",
			displayName: "Batch Robot (eksempel)",
			userPrincipalName: "srv-batch-prod@nav.no",
			accountEnabled: true,
			rpaGroupName: null,
			matchSource: "manual",
		},
	],
	assessments: {},
}

const MOCK_ACTIVITY_PROP = {
	id: "preview",
	type: "entra_id_group_maintenance" as const,
	status: "pending",
	completedAt: null,
	createdAt: new Date().toISOString(),
	changes: [],
}

const MOCK_EVIDENCE_ACTIVITY_PROP = {
	id: "preview",
	type: "oracle_evidence_all",
	status: "pending",
	completedAt: null,
	createdAt: new Date().toISOString(),
}

const MOCK_ORACLE_EVIDENCE_DATA: OracleEvidenceDataProp = {
	configuredInstances: [{ instanceId: "DBPROD01" }, { instanceId: "DBTEST01" }],
	selectedInstanceId: null,
	downloads: [
		{
			id: "preview-dl-1",
			instanceId: "DBPROD01",
			evidenceType: "audit",
			format: "json",
			fileName: "oracle-audit-2025-01-15.json",
			sizeBytes: 204800,
			source: "oracle",
			apiInstanceName: "DBPROD01",
			forceFetchJustification: null,
			performedBy: "Z990001",
			performedAt: new Date("2025-01-15T10:30:00Z").toISOString(),
		},
	],
	evidenceTypes: [],
}

const MOCK_NDA_EVIDENCE_DATA: NdaEvidenceDataProp = {
	appParams: { team: "mitt-team", environment: "prod", appName: "min-applikasjon" },
	periodConfig: { periodType: "monthly", periodStart: "2025-01-01" },
	downloads: [
		{
			id: "preview-nda-1",
			format: "pdf",
			fileName: "leveranserapport-2025-01.pdf",
			sizeBytes: 512000,
			source: "nda",
			forceFetchJustification: null,
			performedBy: "Z990001",
			performedAt: new Date("2025-01-31T14:00:00Z").toISOString(),
		},
	],
}

// ─── Mock data for gjennomgang steps ──────────────────────────────────────────

const MOCK_PARTICIPANTS = [
	{ id: "p-1", userIdent: "Z990001", userName: "Glad Fjord", confirmedAt: "2025-06-10T09:00:00Z" },
	{ id: "p-2", userIdent: "Z990002", userName: "Rask Elv", confirmedAt: null },
]

const MOCK_SUMMARY_HTML =
	"<p>Gjennomgangen ble gjennomført uten vesentlige avvik. Alle tilgangsgrupper er gjennomgått og dokumentert. To punkter er overført til oppfølging.</p>"

const MOCK_LINKS = [
	{
		id: "link-1",
		url: "https://confluence.nav.no/eksempel",
		title: "Arkitekturnotat",
		addedBy: "Z990001",
		addedAt: "2025-06-10T10:00:00Z",
	},
]

const MOCK_REVIEW_ATTACHMENTS = [
	{
		id: "att-1",
		fileName: "tilgangsrapport-2025-06.pdf",
		contentType: "application/pdf",
		sizeBytes: 204800,
		sourceType: "manual",
		uploadedBy: "Z990001",
		uploadedAt: "2025-06-10T10:30:00Z",
	},
]

const MOCK_FOLLOW_UP_POINTS = [
	{
		id: "fp-1",
		text: "Oppdater dokumentasjon for systemtilganger",
		description: "Tre brukere mangler beskrivelse i tilgangsregisteret. Ansvarlig: applikasjonsteamet.",
		resolution: null,
		status: "needs_follow_up" as const,
		createdBy: "Z990001",
		createdAt: "2025-06-10T10:00:00Z",
		updatedBy: "Z990001",
		updatedAt: "2025-06-10T10:00:00Z",
		resolvedAt: null,
		resolvedBy: null,
		attachments: [],
	},
	{
		id: "fp-2",
		text: "Fjern utgåtte AD-grupper",
		description: "To grupper er markert som utgått og skal slettes av IAM-teamet.",
		resolution: "Grupper slettet av IAM-teamet 2025-06-12.",
		status: "completed" as const,
		createdBy: "Z990001",
		createdAt: "2025-06-10T10:05:00Z",
		updatedBy: "Z990002",
		updatedAt: "2025-06-12T14:00:00Z",
		resolvedAt: "2025-06-12T14:00:00Z",
		resolvedBy: "Z990002",
		attachments: [],
	},
]

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request, params }: Route.LoaderArgs) {
	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	await getAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const routine = await getRoutine(rutineId)
	if (!routine) {
		throw data({ message: `Fant ikke rutine: ${rutineId}` }, { status: 404 })
	}

	if (routine.sectionId !== section.id) {
		throw data({ message: "Rutinen tilhører ikke denne seksjonen" }, { status: 403 })
	}

	const [activityLinks, activitySteps] = await Promise.all([
		getRoutineActivityLinks(rutineId),
		getActivityStepsForRoutine(rutineId),
	])

	const routineControlIds = routine.controls.map((c) => c.id)
	const linkedRulesets =
		routineControlIds.length > 0 ? await getRulesetsLinkedToControls(routineControlIds, section.id) : []

	const linkedRulesetsWithHtml = linkedRulesets.map((rs) => ({
		...rs,
		descriptionHtml: renderMarkdown(rs.description),
	}))

	return data({
		section,
		routine,
		routineDescriptionHtml: renderMarkdown(routine.description),
		activityLinks,
		activitySteps,
		linkedRulesets: linkedRulesetsWithHtml,
	})
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ForhåndsvisningGjennomgang() {
	const { section, routine, routineDescriptionHtml, activityLinks, activitySteps, linkedRulesets } =
		useLoaderData<typeof loader>()

	const [searchParams, setSearchParams] = useSearchParams()

	const hasControls = routine.controls.length > 0
	const hasRulesets = linkedRulesets.length > 0

	// Build ActivityStepInfo list — mirrors the real gjennomgang logic.
	// New single-step model: stepTitle is stored on the link itself (stepId = link.id).
	// Legacy multi-step model: steps come from routineActivitySteps (stepId = step.id).
	const activityStepInfos = useMemo<ActivityStepInfo[]>(() => {
		return activityLinks.map((link) => {
			if (link.activityType !== "manual_activity") {
				return { id: link.id, activityType: link.activityType }
			}
			if (link.stepTitle) {
				// New single-step model: one step per link, stepId = link.id
				return {
					id: link.id,
					activityType: link.activityType,
					activitySteps: [{ stepId: link.id, title: link.stepTitle }],
				}
			}
			// Legacy multi-step model
			return {
				id: link.id,
				activityType: link.activityType,
				activitySteps: activitySteps.map((s) => ({ stepId: s.id, title: s.title })),
			}
		})
	}, [activityLinks, activitySteps])

	const steps = useMemo(
		() => buildSteps({ hasControls, hasRulesets, activities: activityStepInfos }),
		[hasControls, hasRulesets, activityStepInfos],
	)

	const stepParam = searchParams.get("step")
	const currentStepId = steps.find((s) => s.id === stepParam)?.id ?? steps[0]?.id ?? "innledning"

	const handleStepChange = useCallback(
		(stepId: string) => {
			setSearchParams(
				(prev) => {
					const next = new URLSearchParams(prev)
					next.set("step", stepId)
					return next
				},
				{ replace: true },
			)
		},
		[setSearchParams],
	)

	// All steps are "completed" in preview so the stepper looks fully navigable
	const completedSteps = useMemo(() => {
		const completed = new Set<string>()
		for (const step of steps) completed.add(step.id)
		return completed
	}, [steps])

	const syntheticReview = {
		id: "preview",
		title: routine.name,
		reviewedAt: new Date().toISOString(),
		createdAt: new Date().toISOString(),
		summary:
			"Gjennomgangen ble gjennomført uten vesentlige avvik. Alle tilgangsgrupper er gjennomgått og dokumentert. To punkter er overført til oppfølging.",
		summaryHtml: MOCK_SUMMARY_HTML,
		createdBy: "Z990001",
		applicationId: null,
		applicationName: null,
		participants: MOCK_PARTICIPANTS,
		attachments: MOCK_REVIEW_ATTACHMENTS.map((a) => ({ id: a.id, fileName: a.fileName })),
		links: MOCK_LINKS,
		followUpPoints: MOCK_FOLLOW_UP_POINTS.map((p) => ({
			id: p.id,
			text: p.text,
			description: p.description,
			status: p.status,
		})),
		status: "draft" as const,
	}

	function renderStep() {
		// Manual activity checklist step (sjekkliste-steg-{UUID})
		const activityStepId = parseActivityStepId(currentStepId)
		if (activityStepId !== null) {
			// New single-step model: stepId === link.id
			const link = activityLinks.find((l) => l.id === activityStepId)
			if (link?.stepTitle) {
				const componentConfig: ComponentConfig | undefined = link.stepComponents
					? { items: link.stepComponents as StepComponent[] }
					: undefined
				return (
					<StepManualActivityItem
						stepId={activityStepId}
						activityId="preview"
						title={link.stepTitle}
						description={link.stepDescription ?? null}
						completedAt={null}
						completedBy={null}
						notes={null}
						isDraft={false}
						reviewId="preview"
						links={[]}
						attachments={[]}
						componentConfig={componentConfig}
					/>
				)
			}

			// Legacy multi-step model: stepId === routineActivitySteps.id
			const stepData = activitySteps.find((s) => s.id === activityStepId) ?? null
			if (!stepData) return null
			return (
				<StepManualActivityItem
					stepId={activityStepId}
					activityId="preview"
					title={stepData.title}
					description={stepData.description}
					completedAt={null}
					completedBy={null}
					notes={null}
					isDraft={false}
					reviewId="preview"
					links={[]}
					attachments={[]}
				/>
			)
		}

		// Dynamic activity step (aktivitet-N)
		// buildSteps uses the running length of all pushed items (including sjekkliste-steg entries)
		// as the N in "aktivitet-N". We mirror that same counting to map back to the correct activity.
		const activityIndex = parseActivityStepIndex(currentStepId)
		if (activityIndex !== null) {
			let stepCount = 0
			let matchedInfo: ActivityStepInfo | null = null
			for (const info of activityStepInfos) {
				if (info.activityType === "manual_activity" && info.activitySteps?.length) {
					stepCount += info.activitySteps.length
				} else {
					if (stepCount === activityIndex) {
						matchedInfo = info
						break
					}
					stepCount++
				}
			}

			if (!matchedInfo) return null
			const activityType = matchedInfo.activityType

			if (activityType === "entra_id_group_maintenance") {
				return (
					<EntraMaintenanceSection activity={MOCK_ACTIVITY_PROP} entraGroupsData={MOCK_ENTRA_GROUPS} isDraft={false} />
				)
			}

			if (activityType === "oracle_role_criticality") {
				return <OracleRoleCriticalityMaintenanceSection data={MOCK_ORACLE_ROLES} isDraft={false} />
			}

			if (activityType === "rpa_user_maintenance") {
				return (
					<RpaUserMaintenanceSection
						activity={{ ...MOCK_ACTIVITY_PROP, type: "rpa_user_maintenance" }}
						rpaMaintenanceData={MOCK_RPA_DATA}
						isDraft={false}
					/>
				)
			}

			if (isOracleEvidenceActivityType(activityType)) {
				return (
					<EvidenceSection
						providerType="oracle"
						activity={{ ...MOCK_EVIDENCE_ACTIVITY_PROP, type: activityType }}
						evidenceData={{
							...MOCK_ORACLE_EVIDENCE_DATA,
							evidenceTypes: oracleEvidenceTypesForActivity[activityType],
						}}
						isDraft={false}
						preview
					/>
				)
			}

			if (isDeploymentEvidenceActivityType(activityType)) {
				return (
					<EvidenceSection
						providerType="deployments"
						activity={{ ...MOCK_EVIDENCE_ACTIVITY_PROP, type: activityType }}
						evidenceData={MOCK_NDA_EVIDENCE_DATA}
						isDraft={false}
						preview
					/>
				)
			}

			// manual_activity without steps (should not happen with valid data)
			return null
		}

		switch (currentStepId) {
			case "innledning":
				return <StepIntroduction review={syntheticReview} isDraft={false} />
			case "krav":
				return <StepControls controls={routine.controls} />
			case "regelsett":
				return <StepRulesets rulesets={linkedRulesets} sectionSlug={section.slug} />
			case "rutine":
				return (
					<StepRoutine routine={routine} routineDescriptionHtml={routineDescriptionHtml} sectionSlug={section.slug} />
				)
			case "dokumentasjon":
				return (
					<VStack gap="space-12">
						<StepSummary review={syntheticReview} isDraft={false} />
						<StepAttachments reviewId="preview" attachments={MOCK_REVIEW_ATTACHMENTS} isDraft={false} />
					</VStack>
				)
			case "oppfolging":
				return <FollowUpPointsSection reviewId="preview" status="completed" points={MOCK_FOLLOW_UP_POINTS} />
			case "fullfor":
				return <StepComplete review={syntheticReview} isDraft={false} preview />
			default:
				return null
		}
	}

	return (
		<VStack gap="space-4">
			<BodyShort size="small">
				<Link to={`/seksjoner/${section.slug}/rutiner/${routine.id}`}>← Tilbake til rutine</Link>
			</BodyShort>
			<ReviewWizard
				title={routine.name}
				status="draft"
				hasControls={hasControls}
				hasRulesets={hasRulesets}
				activities={activityStepInfos}
				currentStepId={currentStepId}
				completedSteps={completedSteps}
				onStepChange={handleStepChange}
				preview
			>
				{renderStep()}
			</ReviewWizard>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
