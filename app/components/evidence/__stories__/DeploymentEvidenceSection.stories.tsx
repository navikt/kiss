import type { Meta, StoryObj } from "@storybook/react"
import { useEffect } from "react"
import { createRoutesStub } from "react-router"
import type { EvidenceStatusResponse } from "~/lib/evidence-providers/types"
import { DeploymentEvidenceSection } from "../DeploymentEvidenceSection"

const meta = {
	title: "Komponenter/DeploymentEvidenceSection",
	parameters: {
		layout: "padded",
	},
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const baseActivity = {
	id: "activity-1",
	type: "deployment_evidence_report",
	status: "pending",
	completedAt: null,
	createdAt: "2026-03-01T08:00:00Z",
}

const appParams = {
	team: "pensjon-saksbehandling",
	environment: "prod-gcp",
	appName: "pensjon-pen",
}

/** Build a realistic EvidenceStatusResponse matching the actual API shape */
function makeStatusResponse(
	overrides: Partial<EvidenceStatusResponse> & {
		items: EvidenceStatusResponse["items"]
		metadata: EvidenceStatusResponse["metadata"]
	},
): EvidenceStatusResponse {
	return {
		providerType: "deployments",
		sourceLabel: `${appParams.team}/${appParams.appName} (${appParams.environment})`,
		collectedAt: new Date().toISOString(),
		externalUrl: null,
		...overrides,
	}
}

export const IngenProdMiljo: Story = {
	name: "Ingen prod-miljø",
	render: () => {
		const Wrapper = () => (
			<DeploymentEvidenceSection
				activity={baseActivity}
				evidenceData={{ appParams: null, periodConfig: null, downloads: [] }}
				isDraft={false}
			/>
		)
		const Stub = createRoutesStub([{ path: "/", Component: Wrapper }])
		return <Stub initialEntries={["/"]} />
	},
}

export const VelgPeriode: Story = {
	name: "Velg periode",
	render: () => {
		const Wrapper = () => (
			<DeploymentEvidenceSection
				activity={baseActivity}
				evidenceData={{ appParams, periodConfig: null, downloads: [] }}
				isDraft={false}
			/>
		)
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-period-config",
				action: async () => ({ success: true }),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}

export const MedPeriodeUtenNedlastinger: Story = {
	name: "Med periode – ingen nedlastinger",
	render: () => {
		const Wrapper = () => (
			<DeploymentEvidenceSection
				activity={baseActivity}
				evidenceData={{
					appParams,
					periodConfig: { periodType: "quarterly", periodStart: "2026-01-01" },
					downloads: [],
				}}
				isDraft={false}
			/>
		)
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-status",
				loader: async () =>
					makeStatusResponse({
						items: [
							{
								id: "deployment-stats",
								label: "Leveranser Q1 2026",
								status: "ok",
								formats: ["pdf"],
								canDownload: false,
							},
						],
						metadata: {
							team: appParams.team,
							environment: appParams.environment,
							appName: appParams.appName,
							period: {
								type: "quarterly",
								label: "Q1 2026",
								start: "2026-01-01",
								end: "2026-04-01",
							},
							deployments: {
								total: 45,
								approved: 42,
								pending: 2,
								notApproved: 1,
								approvedPercent: 93,
								withChangeOrigin: 40,
								changeOriginPercent: 89,
							},
						},
					}),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}

export const MedNedlastinger: Story = {
	name: "Med nedlastinger",
	render: () => {
		const Wrapper = () => (
			<DeploymentEvidenceSection
				activity={baseActivity}
				evidenceData={{
					appParams,
					periodConfig: { periodType: "quarterly", periodStart: "2026-01-01" },
					downloads: [
						{
							id: "dl-1",
							format: "pdf",
							fileName: "leveranserapport-Q1-2026.pdf",
							sizeBytes: 245_000,
							source: "m2m_api",
							forceFetchJustification: null,
							performedBy: "T123456",
							performedAt: "2026-04-01T10:30:00Z",
						},
						{
							id: "dl-2",
							format: "pdf",
							fileName: "leveranserapport-Q1-2026-v2.pdf",
							sizeBytes: 312_000,
							source: "m2m_api",
							forceFetchJustification: "Godkjenningsprosent under terskelverdi, men gjennomgang er fullført",
							performedBy: "T654321",
							performedAt: "2026-04-02T14:15:00Z",
						},
					],
				}}
				isDraft={false}
			/>
		)
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-status",
				loader: async () =>
					makeStatusResponse({
						items: [
							{
								id: "deployment-stats",
								label: "Leveranser Q1 2026",
								status: "ok",
								formats: ["pdf"],
								canDownload: false,
							},
						],
						metadata: {
							team: appParams.team,
							environment: appParams.environment,
							appName: appParams.appName,
							period: {
								type: "quarterly",
								label: "Q1 2026",
								start: "2026-01-01",
								end: "2026-04-01",
							},
							deployments: {
								total: 45,
								approved: 45,
								pending: 0,
								notApproved: 0,
								approvedPercent: 100,
								withChangeOrigin: 44,
								changeOriginPercent: 98,
							},
						},
					}),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}

export const ManuellOpplasting: Story = {
	name: "Manuell opplasting",
	render: () => {
		const Wrapper = () => (
			<DeploymentEvidenceSection
				activity={baseActivity}
				evidenceData={{
					appParams,
					periodConfig: { periodType: "yearly", periodStart: "2025-01-01" },
					downloads: [
						{
							id: "dl-manual-1",
							format: "pdf",
							fileName: "leveranserapport-2025.pdf",
							sizeBytes: 180_000,
							source: "manual_upload",
							forceFetchJustification: null,
							performedBy: "T111222",
							performedAt: "2026-02-15T09:00:00Z",
						},
					],
				}}
				isDraft={false}
			/>
		)
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-status",
				loader: async () =>
					makeStatusResponse({
						items: [],
						metadata: {
							team: appParams.team,
							environment: appParams.environment,
							appName: appParams.appName,
							period: {
								type: "yearly",
								label: "2025",
								start: "2025-01-01",
								end: "2026-01-01",
							},
						},
					}),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}

export const KlarTilGenerering: Story = {
	name: "Klar til generering (draft)",
	render: () => {
		const Wrapper = () => (
			<DeploymentEvidenceSection
				activity={baseActivity}
				evidenceData={{
					appParams,
					periodConfig: { periodType: "quarterly", periodStart: "2026-01-01" },
					downloads: [],
				}}
				isDraft={true}
			/>
		)
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-status",
				loader: async () =>
					makeStatusResponse({
						items: [
							{
								id: "deployment-stats",
								label: "Leveranser Q1 2026",
								status: "ok",
								formats: ["pdf"],
								canDownload: false,
							},
						],
						metadata: {
							team: appParams.team,
							environment: appParams.environment,
							appName: appParams.appName,
							period: {
								type: "quarterly",
								label: "Q1 2026",
								start: "2026-01-01",
								end: "2026-04-01",
							},
							deployments: {
								total: 38,
								approved: 35,
								pending: 2,
								notApproved: 1,
								approvedPercent: 92,
								withChangeOrigin: 33,
								changeOriginPercent: 87,
							},
						},
					}),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}

export const PollFeil: Story = {
	name: "Polling feilet",
	render: () => {
		const Wrapper = () => {
			// Mock fetch so poll-job calls fail immediately instead of hitting network
			useEffect(() => {
				const originalFetch = globalThis.fetch
				globalThis.fetch = async (input, init) => {
					const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
					const body = init?.body
					if (url.includes("/api/evidence-download") && body instanceof FormData && body.get("intent") === "poll-job") {
						return new Response(JSON.stringify({ error: "Service unavailable" }), {
							status: 503,
							headers: { "Content-Type": "application/json" },
						})
					}
					return originalFetch(input, init)
				}
				return () => {
					globalThis.fetch = originalFetch
				}
			}, [])

			return (
				<DeploymentEvidenceSection
					activity={baseActivity}
					evidenceData={{
						appParams,
						periodConfig: { periodType: "quarterly", periodStart: "2026-01-01" },
						downloads: [],
					}}
					isDraft={true}
				/>
			)
		}
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-status",
				loader: async () =>
					makeStatusResponse({
						items: [
							{
								id: "deployment-stats",
								label: "Leveranser Q1 2026",
								status: "ok",
								formats: ["pdf"],
								canDownload: false,
							},
						],
						metadata: {
							team: appParams.team,
							environment: appParams.environment,
							appName: appParams.appName,
							period: {
								type: "quarterly",
								label: "Q1 2026",
								start: "2026-01-01",
								end: "2026-04-01",
							},
							deployments: {
								total: 20,
								approved: 18,
								pending: 1,
								notApproved: 1,
								approvedPercent: 90,
								withChangeOrigin: 17,
								changeOriginPercent: 85,
							},
						},
					}),
			},
			{
				path: "/api/evidence-download",
				action: async () => ({ jobId: "job-will-fail", status: "pending" }),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}

export const KonfliktVedGenerering: Story = {
	name: "Konflikt ved generering",
	render: () => {
		const Wrapper = () => (
			<DeploymentEvidenceSection
				activity={baseActivity}
				evidenceData={{
					appParams,
					periodConfig: { periodType: "yearly", periodStart: "2025-01-01" },
					downloads: [],
				}}
				isDraft={true}
			/>
		)
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-status",
				loader: async () =>
					makeStatusResponse({
						items: [
							{
								id: "report-1",
								label: "Leveranserapport 2025",
								status: "ok",
								formats: ["pdf", "excel"],
								canDownload: true,
								details: undefined,
							},
						],
						metadata: {
							team: appParams.team,
							environment: appParams.environment,
							appName: appParams.appName,
							period: {
								type: "yearly",
								label: "2025",
								start: "2025-01-01",
								end: "2026-01-01",
							},
							deployments: {
								total: 120,
								approved: 118,
								pending: 0,
								notApproved: 2,
								approvedPercent: 98,
								withChangeOrigin: 115,
								changeOriginPercent: 96,
							},
							existingReports: [
								{
									reportId: "report-1",
									generatedAt: "2026-01-15T10:00:00Z",
									availableFormats: ["pdf", "excel"],
								},
							],
						},
					}),
			},
			{
				path: "/api/evidence-download",
				action: async () => ({ conflict: true, error: "Rapport finnes allerede for denne perioden" }),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}

export const IngenAppParamsMedNedlastinger: Story = {
	name: "Ingen prod-miljø – med nedlastinger",
	render: () => {
		const Wrapper = () => (
			<DeploymentEvidenceSection
				activity={baseActivity}
				evidenceData={{
					appParams: null,
					periodConfig: null,
					downloads: [
						{
							id: "dl-old-1",
							format: "pdf",
							fileName: "leveranserapport-Q4-2025.pdf",
							sizeBytes: 290_000,
							source: "m2m_api",
							forceFetchJustification: null,
							performedBy: "T123456",
							performedAt: "2026-01-10T08:30:00Z",
						},
						{
							id: "dl-old-2",
							format: "pdf",
							fileName: "leveranserapport-Q3-2025.pdf",
							sizeBytes: 210_000,
							source: "manual_upload",
							forceFetchJustification: null,
							performedBy: "T654321",
							performedAt: "2025-10-05T14:00:00Z",
						},
					],
				}}
				isDraft={false}
			/>
		)
		const Stub = createRoutesStub([{ path: "/", Component: Wrapper }])
		return <Stub initialEntries={["/"]} />
	},
}
