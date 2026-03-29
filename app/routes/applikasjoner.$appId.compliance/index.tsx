import { Button, Heading, Select, Textarea, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useActionData, useLoaderData } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { ComplianceComment, ComplianceStatusBadge, statusLabels } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments } from "~/db/queries/applications.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const result = await getAppAssessments(appId)
	if (!result) throw new Response("Applikasjon ikke funnet", { status: 404 })

	return data({ appId, appName: result.app.name, assessments: result.assessments })
}

const validStatuses: ComplianceStatusValue[] = [
	"not_relevant",
	"not_implemented",
	"partially_implemented",
	"implemented",
]

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const controlId = formData.get("controlId")
	const status = formData.get("status")
	const comment = formData.get("comment")

	if (typeof controlId !== "string" || !controlId) {
		throw new Response("Mangler kontroll-ID", { status: 400 })
	}

	if (typeof status !== "string" || !validStatuses.includes(status as ComplianceStatusValue)) {
		throw new Response("Ugyldig status", { status: 400 })
	}

	// Placeholder – will save to DB
	return data({
		success: true,
		controlId,
		status: status as ComplianceStatusValue,
		comment: typeof comment === "string" ? comment : "",
	})
}

export default function ComplianceAssessment() {
	const { appName, assessments } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Compliance-vurdering: {appName}
			</Heading>

			{actionData?.success && (
				<div className="compliance-success" role="status">
					Vurdering for {actionData.controlId} er lagret.
				</div>
			)}

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

export { RouteErrorBoundary as ErrorBoundary }
