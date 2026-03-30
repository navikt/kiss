import { Alert, BodyLong, Button, Detail, Heading, Label, Select, Textarea, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { ComplianceComment, ComplianceStatusBadge, statusLabels } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments, saveAssessment } from "~/db/queries/applications.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const result = await getAppAssessments(appId)
	if (!result) throw new Response("Applikasjon ikke funnet", { status: 404 })

	return data({
		appId,
		appName: result.app.name,
		assessments: result.assessments,
		isInherited: result.isInherited,
		primaryName: result.primaryName,
		primaryId: result.app.primaryApplicationId,
	})
}

const validStatuses: ComplianceStatusValue[] = [
	"not_relevant",
	"not_implemented",
	"partially_implemented",
	"implemented",
]

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const formData = await request.formData()
	const controlUuid = formData.get("controlUuid")
	const controlId = formData.get("controlId")
	const status = formData.get("status")
	const comment = formData.get("comment")

	if (typeof controlUuid !== "string" || !controlUuid) {
		throw new Response("Mangler kontroll-UUID", { status: 400 })
	}

	if (typeof status !== "string" || !validStatuses.includes(status as ComplianceStatusValue)) {
		throw new Response("Ugyldig status", { status: 400 })
	}

	await saveAssessment(appId, controlUuid, status, typeof comment === "string" ? comment : "", authedUser.navIdent)

	return data({
		success: true,
		controlId: typeof controlId === "string" ? controlId : controlUuid,
	})
}

export default function ComplianceAssessment() {
	const { appName, assessments, isInherited, primaryName, primaryId } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Compliance-vurdering: {appName}
			</Heading>

			{isInherited && primaryId && (
				<Alert variant="info" size="small">
					Compliance-vurderingene for denne applikasjonen arves fra primærapplikasjonen{" "}
					<Link to={`/applikasjoner/${primaryId}/compliance`}>{primaryName}</Link>. Endringer må gjøres på
					primærapplikasjonen.
				</Alert>
			)}

			{actionData?.success && (
				<div className="compliance-success" role="status">
					Vurdering for {actionData.controlId} er lagret.
				</div>
			)}

			{assessments.map((assessment) => (
				<div key={assessment.controlUuid} className="compliance-card">
					<div className="compliance-card-header">
						<Heading size="small" level="3">
							{assessment.controlId}: {assessment.controlName}
						</Heading>
						<span className="compliance-domain-tag">
							{assessment.domainCode}: {assessment.domainName}
						</span>
					</div>

					{assessment.requirement && (
						<VStack gap="space-2">
							<Label size="small">Krav</Label>
							<BodyLong size="small" style={{ whiteSpace: "pre-wrap" }}>
								{assessment.requirement}
							</BodyLong>
						</VStack>
					)}

					{assessment.risks.length > 0 && (
						<VStack gap="space-2">
							<Label size="small">Tilknyttede risikoer</Label>
							{assessment.risks.map((risk) => (
								<Detail key={risk.riskId}>
									<strong>{risk.riskId}</strong>: {risk.name}
								</Detail>
							))}
						</VStack>
					)}

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
						<input type="hidden" name="controlUuid" value={assessment.controlUuid} />
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
