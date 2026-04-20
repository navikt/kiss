import { PencilWritingIcon, PlusIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, Detail, HStack, List, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ComplianceStatus } from "~/lib/compliance-status"
import { statusLabels, statusVariants } from "~/lib/compliance-status"
import { ControlCommentPanel } from "./ControlCommentPanel"

export function ControlRow({
	item,
	children,
	colSpan,
}: {
	item: {
		controlUuid: string
		technologyElementId: string | null
		applicationControlId: string | null
		autoReason: string | null
		screeningDetails: Array<{ questionTitle: string; answer: string; effect: string }>
		comment: string | null
		commentUpdatedAt: string | null
		commentUpdatedBy: string | null
	}
	children: React.ReactNode
	colSpan: number
}) {
	const [isOpen, setIsOpen] = useState(!!item.comment)
	const [editRequested, setEditRequested] = useState(false)

	const effectLabel = (effect: string) => statusLabels[effect as ComplianceStatus] ?? effect

	return (
		<Table.ExpandableRow
			key={`${item.controlUuid}:${item.technologyElementId ?? "null"}`}
			open={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open)
				if (!open) setEditRequested(false)
			}}
			content={
				<VStack gap="space-4">
					{item.autoReason && (
						<Box padding="space-4" paddingBlock="space-2">
							<VStack gap="space-2">
								<HStack gap="space-4" align="center">
									<Detail weight="semibold" textColor="subtle">
										Begrunnelse:
									</Detail>
									<BodyShort size="small" textColor="subtle">
										{item.autoReason}
									</BodyShort>
								</HStack>
								{item.screeningDetails.length > 0 && (
									<List size="small" as="ul" aria-label="Screening-svar som påvirker denne kontrollen">
										{item.screeningDetails.map((d) => (
											<List.Item key={`${d.questionTitle}-${d.answer}`}>
												{d.questionTitle}: <strong>{d.answer}</strong>{" "}
												<Tag variant={statusVariants[d.effect as ComplianceStatus] ?? "neutral"} size="xsmall">
													{effectLabel(d.effect)}
												</Tag>
											</List.Item>
										))}
									</List>
								)}
							</VStack>
						</Box>
					)}
					<ControlCommentPanel
						applicationControlId={item.applicationControlId}
						comment={item.comment}
						commentUpdatedAt={item.commentUpdatedAt}
						commentUpdatedBy={item.commentUpdatedBy}
						startEditing={editRequested}
					/>
				</VStack>
			}
			togglePlacement="right"
			expandOnRowClick={false}
			colSpan={colSpan}
		>
			{children}
			<Table.DataCell>
				<Button
					size="xsmall"
					variant="tertiary"
					icon={item.comment ? <PencilWritingIcon aria-hidden /> : <PlusIcon aria-hidden />}
					onClick={() => {
						setEditRequested(true)
						setIsOpen(true)
					}}
				>
					{item.comment ? "Rediger" : "Legg til"}
				</Button>
			</Table.DataCell>
		</Table.ExpandableRow>
	)
}
