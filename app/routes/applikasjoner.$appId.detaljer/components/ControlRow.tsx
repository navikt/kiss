import { PencilWritingIcon, PlusIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, Detail, HStack, Table, VStack } from "@navikt/ds-react"
import { useState } from "react"
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
		comment: string | null
		commentUpdatedAt: string | null
		commentUpdatedBy: string | null
	}
	children: React.ReactNode
	colSpan: number
}) {
	const [isOpen, setIsOpen] = useState(!!item.comment)
	const [editRequested, setEditRequested] = useState(false)

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
							<HStack gap="space-4" align="center">
								<Detail weight="semibold" textColor="subtle">
									Begrunnelse:
								</Detail>
								<BodyShort size="small" textColor="subtle">
									{item.autoReason}
								</BodyShort>
							</HStack>
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
