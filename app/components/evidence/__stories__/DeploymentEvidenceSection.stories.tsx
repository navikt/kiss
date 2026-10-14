import type { Meta, StoryObj } from "@storybook/react"
import { useEffect } from "react"
import { createRoutesStub, useLoaderData } from "react-router"
import { expect, userEvent, within } from "storybook/test"
import type { NdaReportGenerationState, NdaReportSnapshot, PeriodConfig } from "~/db/schema/routines"
import { DeploymentEvidenceSection, type NdaEvidenceDataProp } from "../DeploymentEvidenceSection"

const meta = {
	title: "Komponenter/DeploymentEvidenceSection",
	parameters: { layout: "padded" },
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
	applicationId: "app-1",
	team: "pensjon-saksbehandling",
	environment: "prod-gcp",
	appName: "pensjon-pen",
}

const linkedAppParams = {
	applicationId: "app-2",
	team: "pensjon-saksbehandling",
	environment: "prod-gcp",
	appName: "pensjon-pen-linked",
}

const period = { periodType: "quarterly", periodStart: "2026-01-01" } as const
const reportsPendingWarning = "Du kan ikke fullføre gjennomgangen før rapporter er generert for alle applikasjonene."

function reportSnapshot(reportId: string, overrides: Partial<NdaReportSnapshot> = {}): NdaReportSnapshot {
	return {
		reportId,
		periodType: "quarterly",
		periodStart: period.periodStart,
		periodEnd: "2026-03-31",
		periodLabel: "Q1 2026",
		generatedAt: "2026-04-01T10:00:00Z",
		generatedBy: "Z990001",
		totalDeployments: 45,
		approvedCount: 42,
		withChangeOriginCount: 40,
		contentHash: "sha256:example",
		availableFormats: ["pdf", "excel"],
		...overrides,
	}
}

function reportState(
	app: typeof appParams,
	status: NdaReportGenerationState["status"],
	options: { report?: NdaReportSnapshot | null; error?: string | null; jobId?: string | null } = {},
): NdaReportGenerationState {
	return {
		applicationId: app.applicationId,
		team: app.team,
		environment: app.environment,
		appName: app.appName,
		attemptId: `attempt-${app.applicationId}`,
		jobId: options.jobId ?? null,
		status,
		report: options.report ?? null,
		error: options.error ?? null,
		updatedAt: new Date().toISOString(),
	}
}

function periodConfig(
	apps: NdaReportGenerationState[] = [],
	selectedPeriod: Pick<PeriodConfig, "periodType" | "periodStart"> = period,
): PeriodConfig {
	return {
		...selectedPeriod,
		reportGeneration: {
			apps,
		},
	}
}

function downloads(
	appOverrides: Partial<NdaEvidenceDataProp["downloads"][number]> = {},
	formats: Array<"pdf" | "excel"> = ["pdf"],
): NdaEvidenceDataProp["downloads"] {
	return formats.map((format, index) => ({
		id: `download-${index + 1}`,
		format,
		fileName: `leveranserapport-Q1-2026.${format === "excel" ? "xlsx" : "pdf"}`,
		sizeBytes: 245_000,
		source: "m2m_api",
		forceFetchJustification: null,
		performedBy: "Z990001",
		performedAt: "2026-04-01T10:30:00Z",
		team: appParams.team,
		environment: appParams.environment,
		appName: appParams.appName,
		periodType: period.periodType,
		periodStart: period.periodStart,
		reportId: null,
		...appOverrides,
	}))
}

function renderEvidence({
	apps = [appParams],
	config = null,
	savedDownloads = [],
	isDraft = true,
}: {
	apps?: (typeof appParams)[]
	config?: PeriodConfig | null
	savedDownloads?: NdaEvidenceDataProp["downloads"]
	isDraft?: boolean
} = {}) {
	const Wrapper = () => (
		<DeploymentEvidenceSection
			activity={baseActivity}
			evidenceData={{ apps, periodConfig: config, downloads: savedDownloads }}
			isDraft={isDraft}
		/>
	)
	const Stub = createRoutesStub([
		{ path: "/", Component: Wrapper },
		{ path: "/api/evidence-download", action: async () => ({ success: true }) },
	])
	return <Stub initialEntries={["/"]} />
}

export const IngenProdMiljo: Story = {
	name: "Ingen prod-miljø",
	render: () => renderEvidence({ apps: [], isDraft: false }),
}

export const VelgPeriode: Story = {
	name: "Velg periode",
	render: () => renderEvidence(),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		expect(await canvas.findByLabelText("Periodetype")).toBeTruthy()
		expect(await canvas.findByLabelText("Periode")).toBeTruthy()
	},
}

export const MedPeriodeUtenNedlastinger: Story = {
	name: "Med periode – ingen lagrede bevis",
	render: () => renderEvidence({ config: { ...period }, isDraft: false }),
}

export const MedHistoriskBevis: Story = {
	name: "Med historisk bevis (endret app-konfigurasjon)",
	render: () =>
		renderEvidence({
			config: { ...period },
			savedDownloads: downloads({
				team: "gammelt-team",
				appName: "gammelt-appnavn",
				periodStart: "2025-10-01",
			}),
			isDraft: false,
		}),
}

export const MedBevisFraAnnenPeriode: Story = {
	name: "Med bevis fra annen periode",
	render: () =>
		renderEvidence({
			config: { ...period },
			savedDownloads: downloads({ periodStart: "2025-10-01" }),
		}),
}

export const ManuellOpplasting: Story = {
	name: "Tidligere manuelt opplastet bevis",
	render: () =>
		renderEvidence({
			config: { ...period },
			savedDownloads: downloads({
				source: "manual_upload",
				fileName: "leveranserapport-manuell.pdf",
			}),
			isDraft: false,
		}),
}

export const KlarTilGenerering: Story = {
	name: "Periode valgt – rapport mangler",
	render: () => renderEvidence({ config: { ...period } }),
}

export const GenereringEtterPeriodevalg: Story = {
	name: "Automatisk generering etter periodevalg",
	render: () => {
		const storyState: { config: PeriodConfig | null } = { config: null }
		const loader = () => ({ config: storyState.config })
		const Wrapper = () => {
			const data = useLoaderData<typeof loader>()

			useEffect(() => {
				const originalFetch = globalThis.fetch
				const mockFetch: typeof fetch = async (input, init) => {
					const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
					const body = init?.body
					if (url.includes("/api/evidence-download") && body instanceof FormData && body.get("intent") === "poll-job") {
						const state = storyState.config?.reportGeneration?.apps[0]
						if (state) {
							storyState.config = periodConfig([
								{
									...state,
									status: "ready",
									jobId: null,
									report: reportSnapshot("generated-report", {
										periodType: storyState.config?.periodType ?? period.periodType,
										periodStart: storyState.config?.periodStart ?? period.periodStart,
									}),
								},
							])
						}
						return new Response(JSON.stringify({ success: true, status: "completed" }), {
							headers: { "Content-Type": "application/json" },
						})
					}
					return originalFetch(input, init)
				}
				globalThis.fetch = mockFetch
				return () => {
					if (globalThis.fetch === mockFetch) globalThis.fetch = originalFetch
				}
			}, [])

			return (
				<DeploymentEvidenceSection
					activity={baseActivity}
					evidenceData={{ apps: [appParams], periodConfig: data.config, downloads: [] }}
					isDraft
				/>
			)
		}

		const Stub = createRoutesStub([
			{ path: "/", loader, Component: Wrapper },
			{
				path: "/api/evidence-download",
				action: async ({ request }) => {
					const form = await request.formData()
					if (form.get("intent") === "generate-report-set") {
						const state = reportState(appParams, "pending", { jobId: "job-story" })
						storyState.config = periodConfig([state], {
							periodType: String(form.get("periodType")) as PeriodConfig["periodType"],
							periodStart: String(form.get("periodStart")),
						})
						return { success: true }
					}
					return { success: true, status: "completed" }
				},
			},
		])
		return <Stub initialEntries={["/"]} />
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const periodSelect = (await canvas.findByLabelText("Periode")) as HTMLSelectElement
		const firstAvailablePeriod = periodSelect.options[1]?.value
		if (!firstAvailablePeriod) throw new Error("Storybook-fiksturen må ha minst én tilgjengelig periode")
		await userEvent.selectOptions(periodSelect, firstAvailablePeriod)
		await userEvent.click(canvas.getByRole("button", { name: "Generer rapporter for valgt periode" }))
		expect(await canvas.findByText("42 godkjent", { exact: false })).toBeTruthy()
		expect(canvas.queryByText("Periodevalg lagret.")).toBeNull()
		expect(canvas.queryByRole("button", { name: "Oppdater rapporter" })).toBeNull()
		expect(await canvas.findByRole("button", { name: "Generer rapporter for valgt periode" })).toBeTruthy()
		expect(canvas.queryByRole("button", { name: /Registrer rapporter/ })).toBeNull()
	},
}

export const PollFeil: Story = {
	name: "Polling feilet",
	render: () =>
		renderEvidence({
			config: periodConfig([
				reportState(appParams, "failed", {
					error: "Kunne ikke sjekke rapportstatus. Prøv å hente rapportene på nytt.",
				}),
			]),
		}),
}

export const KonfliktVedGenerering: Story = {
	name: "Feil ved rapportgenerering",
	render: () =>
		renderEvidence({
			config: periodConfig([
				reportState(appParams, "failed", {
					error: "NDA kunne ikke hente rapporten for valgt periode.",
				}),
			]),
		}),
}

export const IngenAppParamsMedNedlastinger: Story = {
	name: "Ingen prod-miljø – med lagrede bevis",
	render: () => renderEvidence({ apps: [], savedDownloads: downloads(), isDraft: false }),
}

export const RapportKlarIkkeRegistrertSomBevis: Story = {
	name: "Rapport klar – filer lagres ved fullføring",
	render: () =>
		renderEvidence({
			config: periodConfig([reportState(appParams, "ready", { report: reportSnapshot("report-1") })]),
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		expect(await canvas.findByText(/lagres som bevis når gjennomgangen fullføres/)).toBeTruthy()
		expect(canvas.queryByText(/Rapportfilene er ikke lagret ennå/)).toBeNull()
		expect(canvas.getByText("40 av 45 leveranser har endringsopphav")).toBeTruthy()
		const pdfLink = canvas.getByRole("link", { name: "Vis PDF-rapport for pensjon-pen i ny fane" })
		expect(pdfLink.textContent).toBe("PDF")
		expect(pdfLink.getAttribute("href")).toBe(
			"/api/evidence-report-preview?activityId=activity-1&applicationId=app-1&attemptId=attempt-app-1&reportId=report-1&format=pdf",
		)
		const excelLink = canvas.getByRole("link", { name: "Vis EXCEL-rapport for pensjon-pen i ny fane" })
		expect(excelLink.textContent).toBe("EXCEL")
		expect(excelLink.getAttribute("target")).toBe("_blank")
		expect(canvas.queryByRole("button", { name: /Registrer rapporter/ })).toBeNull()
	},
}

export const RapportRegistrertSomBevis: Story = {
	name: "Rapportfil allerede lagret som bevis",
	render: () =>
		renderEvidence({
			config: periodConfig([reportState(appParams, "ready", { report: reportSnapshot("report-1") })]),
			savedDownloads: downloads({ reportId: "report-1" }, ["pdf", "excel"]),
			isDraft: false,
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		expect(canvas.getAllByRole("row")).toHaveLength(2)
		expect(canvas.getByText("40 av 45 leveranser har endringsopphav")).toBeTruthy()
		const previewLink = await canvas.findByRole("link", { name: "Vis PDF-rapport for pensjon-pen i ny fane" })
		expect(previewLink.textContent).toBe("PDF")
		expect(previewLink.getAttribute("href")).toBe("/api/evidence-file/download-1?view=true")
		expect(previewLink.getAttribute("target")).toBe("_blank")
		expect(canvas.getByRole("link", { name: "Vis EXCEL-rapport for pensjon-pen i ny fane" })).toBeTruthy()
	},
}

export const StatusfeilFraApi: Story = {
	name: "Feil ved generering fra API",
	render: () => {
		const Wrapper = () => (
			<DeploymentEvidenceSection
				activity={baseActivity}
				evidenceData={{ apps: [appParams], periodConfig: { ...period }, downloads: [] }}
				isDraft
			/>
		)
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-download",
				action: async () => ({ error: "Kunne ikke hente rapporter fra NDA." }),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(await canvas.findByRole("button", { name: "Generer rapporter for valgt periode" }))
		expect(await canvas.findByRole("alert")).toBeTruthy()
	},
}

export const NdaUtilgjengelig: Story = {
	name: "NDA utilgjengelig",
	render: () =>
		renderEvidence({
			config: periodConfig([
				reportState(appParams, "failed", {
					error: "Leveranserapport-tjenesten i NDA er ikke tilgjengelig. Prøv igjen senere.",
				}),
			]),
		}),
}

function renderLinkedApps(allReportsReady = false) {
	const states = allReportsReady
		? [
				reportState(appParams, "ready", { report: reportSnapshot("report-app-1") }),
				reportState(linkedAppParams, "ready", {
					report: reportSnapshot("report-app-2", {
						totalDeployments: 6,
						approvedCount: 5,
						withChangeOriginCount: 5,
					}),
				}),
			]
		: [
				reportState(appParams, "ready", { report: reportSnapshot("report-app-1") }),
				reportState(linkedAppParams, "failed", { error: "NDA-tjenesten er midlertidig utilgjengelig." }),
			]
	return renderEvidence({ apps: [appParams, linkedAppParams], config: periodConfig(states) })
}

export const ToLenkedeApplikasjoner: Story = {
	name: "Samlet oversikt – lenkede applikasjoner",
	render: () => renderLinkedApps(),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		expect(await canvas.findByText("NDA-tjenesten er midlertidig utilgjengelig.")).toBeTruthy()
		expect(canvas.getByText(reportsPendingWarning)).toBeTruthy()
		expect(canvas.getAllByRole("row")).toHaveLength(3)
		const periodSelect = canvas.getByRole("combobox", { name: "Periode" })
		const alternatePeriod = Array.from(periodSelect.querySelectorAll("option"))
			.map((option) => option.value)
			.find((value) => value !== "" && value !== period.periodStart)
		if (!alternatePeriod) throw new Error("Forventet minst én alternativ periode")
		await userEvent.selectOptions(periodSelect, alternatePeriod)
		expect(await canvas.findByRole("button", { name: "Generer rapporter for valgt periode" })).toBeTruthy()
		expect(canvas.queryByRole("button", { name: /Registrer rapporter/ })).toBeNull()
	},
}

export const RegistrerAlleRapporter: Story = {
	name: "Rapporter generert – flere applikasjoner",
	render: () => renderLinkedApps(true),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		expect(await canvas.findByText(/Rapportene er hentet fra NDA/)).toBeTruthy()
		expect(canvas.queryByText(reportsPendingWarning)).toBeNull()
		expect(canvas.getAllByText("Klar", { exact: true })).toHaveLength(2)
		expect(canvas.queryByRole("columnheader", { name: "Generert" })).toBeNull()
		expect(canvas.queryByRole("columnheader", { name: "Handlinger" })).toBeNull()
		expect(canvas.getAllByRole("row")).toHaveLength(3)
		expect(canvas.getByRole("button", { name: "Generer rapporter for valgt periode" })).toBeTruthy()
		expect(canvas.getByText("42 av 45 leveranser godkjent")).toBeTruthy()
		expect(canvas.getByText("40 av 45 leveranser har endringsopphav")).toBeTruthy()
		expect(canvas.getByText("5 av 6 leveranser godkjent")).toBeTruthy()
		expect(canvas.getByText("5 av 6 leveranser har endringsopphav")).toBeTruthy()
		expect(canvas.queryByRole("button", { name: /Registrer rapporter/ })).toBeNull()
	},
}
