import { PencilWritingIcon, PlusIcon } from "@navikt/aksel-icons"
import { Button, Table } from "@navikt/ds-react"
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
				<ControlCommentPanel
					applicationControlId={item.applicationControlId}
					comment={item.comment}
					commentUpdatedAt={item.commentUpdatedAt}
					commentUpdatedBy={item.commentUpdatedBy}
					startEditing={editRequested}
				/>
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
