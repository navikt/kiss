import { Heading, HStack, Tag, VStack } from "@navikt/ds-react"
import { useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { AddLinkSection } from "./components/AddLinkSection"
import { AttachmentsTable } from "./components/AttachmentsTable"
import { CompleteSection } from "./components/CompleteSection"
import { DiscardSection } from "./components/DiscardSection"
import { EditForm } from "./components/EditForm"
import { EntraMaintenanceSection } from "./components/EntraMaintenanceSection"
import { LinksTable } from "./components/LinksTable"
import { ParticipantsTable } from "./components/ParticipantsTable"
import { ReadOnlyHeader } from "./components/ReadOnlyHeader"
import { UploadSection } from "./components/UploadSection"
import type { loader } from "./loader.server"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function GjennomgangDetalj() {
	const { section, routine, review, activity, entraGroupsData } = useLoaderData<typeof loader>()
	const isDraft = review.status === "draft"

	return (
		<VStack gap="space-8" style={{ maxWidth: "64rem" }}>
			<div>
				<HStack gap="space-4" align="center">
					<Heading size="xlarge" level="2">
						{review.title}
					</Heading>
					{isDraft ? (
						<Tag variant="warning" size="small">
							Utkast
						</Tag>
					) : (
						<Tag variant="success" size="small">
							Fullført
						</Tag>
					)}
				</HStack>
			</div>

			{isDraft ? (
				<EditForm section={section} routine={routine} review={review} />
			) : (
				<ReadOnlyHeader section={section} routine={routine} review={review} />
			)}

			<ParticipantsTable participants={review.participants} />

			{activity?.type === "entra_id_group_maintenance" && entraGroupsData && (
				<EntraMaintenanceSection activity={activity} entraGroupsData={entraGroupsData} isDraft={isDraft} />
			)}

			<AttachmentsTable attachments={review.attachments} />

			<LinksTable links={review.links} isDraft={isDraft} />

			{isDraft && <AddLinkSection />}
			{isDraft && <UploadSection reviewId={review.id} />}
			{isDraft && <CompleteSection />}
			{isDraft && <DiscardSection />}
		</VStack>
	)
}
