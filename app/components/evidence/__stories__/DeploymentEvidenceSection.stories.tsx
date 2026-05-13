import type { Meta, StoryObj } from "@storybook/react"
import { createRoutesStub } from "react-router"
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
				loader: async () => ({
					status: "ok",
					items: [
						{
							id: "deployment-stats",
							label: "Leveranser Q1 2026",
							status: "ok",
							formats: ["pdf"],
							canDownload: false,
							details: {
								total: 45,
								approved: 42,
								pending: 2,
								notApproved: 1,
								approvedPercent: 93,
								withChangeOrigin: 40,
								changeOriginPercent: 89,
							},
						},
					],
					metadata: {
						periodType: "quarterly",
						periodStart: "2026-01-01",
						periodEnd: "2026-04-01",
						periodLabel: "Q1 2026",
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
				loader: async () => ({
					status: "ok",
					items: [
						{
							id: "deployment-stats",
							label: "Leveranser Q1 2026",
							status: "ok",
							formats: ["pdf"],
							canDownload: false,
							details: {
								total: 45,
								approved: 45,
								pending: 0,
								notApproved: 0,
								approvedPercent: 100,
								withChangeOrigin: 44,
								changeOriginPercent: 98,
							},
						},
					],
					metadata: {
						periodType: "quarterly",
						periodStart: "2026-01-01",
						periodEnd: "2026-04-01",
						periodLabel: "Q1 2026",
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
				loader: async () => ({
					status: "ok",
					items: [],
					metadata: {
						periodType: "yearly",
						periodStart: "2025-01-01",
						periodEnd: "2026-01-01",
						periodLabel: "2025",
					},
				}),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}
