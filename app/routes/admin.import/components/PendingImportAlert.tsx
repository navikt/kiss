import { Alert, BodyLong, Button, Heading, HStack } from "@navikt/ds-react"
import { Form } from "react-router"

interface PendingImport {
	sourceFileName: string
	createdAt: Date | string
	createdBy: string
}

interface PendingImportAlertProps {
	pendingImport: PendingImport
	isSubmitting: boolean
}

export function PendingImportAlert({ pendingImport, isSubmitting }: PendingImportAlertProps) {
	return (
		<Alert variant="warning">
			<Heading size="small" level="3" spacing>
				Ventende import: {pendingImport.sourceFileName}
			</Heading>
			<BodyLong spacing>
				Lastet opp {new Date(pendingImport.createdAt).toLocaleString("nb-NO")} av {pendingImport.createdBy}. Velg om du
				vil fortsette med denne importen eller forkaste den.
			</BodyLong>
			<HStack gap="space-4">
				<Form method="post">
					<input type="hidden" name="intent" value="continue" />
					<Button type="submit" variant="primary" size="small" loading={isSubmitting}>
						Fortsett import
					</Button>
				</Form>
				<Form method="post">
					<input type="hidden" name="intent" value="discard" />
					<Button type="submit" variant="danger" size="small" loading={isSubmitting}>
						Forkast
					</Button>
				</Form>
			</HStack>
		</Alert>
	)
}
