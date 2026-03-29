import { Button, Heading, Select, Textarea, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useActionData, useLoaderData } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { ComplianceComment, ComplianceStatusBadge, statusLabels } from "~/components/ComplianceStatus"

interface ControlAssessment {
	controlId: string
	controlName: string
	domain: string
	status: ComplianceStatusValue | null
	comment: string | null
	assessedBy: string | null
	assessedAt: string | null
}

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	// Placeholder data – will be replaced with DB queries
	const appName = `App ${appId}`
	const assessments: ControlAssessment[] = [
		{
			controlId: "K-ST.01",
			controlName: "Scoping av økonomisystem",
			domain: "Styring",
			status: "implemented",
			comment: "Gjennomgått Q1 2026. Se https://jira.nav.no/browse/KISS-123",
			assessedBy: "A123456",
			assessedAt: "2026-03-15T10:00:00Z",
		},
		{
			controlId: "K-TS.01",
			controlName: "Tildeling av rettigheter",
			domain: "Tilgangsstyring",
			status: "partially_implemented",
			comment: "AD-grupper er satt opp, men periodisk gjennomgang mangler.",
			assessedBy: "B654321",
			assessedAt: "2026-03-10T14:00:00Z",
		},
		{
			controlId: "K-EH.01",
			controlName: "Regelsett for endringshåndtering",
			domain: "Endringshåndtering",
			status: null,
			comment: null,
			assessedBy: null,
			assessedAt: null,
		},
	]

	return data({ appId, appName, assessments })
}

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const controlId = formData.get("controlId") as string
	const status = formData.get("status") as ComplianceStatusValue
	const comment = formData.get("comment") as string

	// Placeholder – will save to DB
	return data({ success: true, controlId, status, comment })
}

export default function ComplianceAssessment() {
	const { appName, assessments } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Compliance-vurdering: {appName}
			</Heading>

			{actionData?.success && <div className="compliance-success">Vurdering for {actionData.controlId} er lagret.</div>}

			{assessments.map((assessment) => (
				<div key={assessment.controlId} className="compliance-card">
					<div className="compliance-card-header">
						<Heading size="small" level="3">
							{assessment.controlId}: {assessment.controlName}
						</Heading>
						<span className="compliance-domain-tag">{assessment.domain}</span>
					</div>

					{assessment.status && (
						<div className="compliance-current">
							<ComplianceStatusBadge status={assessment.status} />
							{assessment.assessedBy && (
								<span className="compliance-meta">
									Vurdert av {assessment.assessedBy}{" "}
									{assessment.assessedAt && new Date(assessment.assessedAt).toLocaleDateString("nb-NO")}
								</span>
							)}
						</div>
					)}

					{assessment.comment && <ComplianceComment comment={assessment.comment} />}

					<Form method="post" className="compliance-form">
						<input type="hidden" name="controlId" value={assessment.controlId} />
						<Select label="Status" name="status" defaultValue={assessment.status ?? ""} size="small">
							<option value="" disabled>
								Velg status
							</option>
							{Object.entries(statusLabels).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</Select>
						<Textarea
							label="Kommentar"
							name="comment"
							defaultValue={assessment.comment ?? ""}
							size="small"
							description="Lenker i kommentaren vil vises som klikkbare lenker."
						/>
						<Button type="submit" size="small" variant="primary">
							Lagre vurdering
						</Button>
					</Form>
				</div>
			))}
		</VStack>
	)
}
