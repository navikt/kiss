import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DragVerticalIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, HStack, Select, Tag, VStack } from "@navikt/ds-react"
import { useCallback, useEffect, useState } from "react"
import { ACTIVITY_TYPE_GROUPS, activityTypeLabels, type RoutineActivityType } from "~/lib/activity-types"

type Props = {
	/** Currently selected activity types (ordered) */
	initialActivities?: RoutineActivityType[]
	/** Form field name for hidden input containing JSON array */
	name?: string
	/** Whether editing is disabled */
	disabled?: boolean
	/** Id used by ErrorSummary anchor links */
	id?: string
}

function SortableActivityItem({
	activityType,
	index,
	onRemove,
	disabled,
}: {
	activityType: RoutineActivityType
	index: number
	onRemove: () => void
	disabled?: boolean
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: activityType,
		disabled,
	})

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	}

	return (
		<Box
			ref={setNodeRef}
			style={style}
			padding="space-8"
			borderWidth="1"
			borderColor={isDragging ? "brand-blue-strong" : "neutral-subtle"}
			borderRadius="8"
		>
			<HStack justify="space-between" align="center" gap="space-4">
				<HStack gap="space-4" align="center">
					{!disabled && (
						<button
							type="button"
							{...attributes}
							{...listeners}
							style={{
								cursor: isDragging ? "grabbing" : "grab",
								background: "none",
								border: "none",
								padding: "4px",
								display: "flex",
								alignItems: "center",
								color: "var(--ax-text-subtle)",
							}}
							aria-label={`Dra for å endre rekkefølge: ${activityTypeLabels[activityType]}`}
						>
							<DragVerticalIcon aria-hidden fontSize="1.25rem" />
						</button>
					)}
					<Tag variant="neutral" size="small">
						#{index + 1}
					</Tag>
					<BodyShort size="small">{activityTypeLabels[activityType]}</BodyShort>
				</HStack>
				{!disabled && (
					<Button
						type="button"
						size="xsmall"
						variant="tertiary-neutral"
						icon={<TrashIcon aria-hidden />}
						onClick={onRemove}
					>
						Fjern
					</Button>
				)}
			</HStack>
		</Box>
	)
}

export function SortableActivityList({
	initialActivities = [],
	name = "activityTypes",
	disabled = false,
	id = "activityTypes",
}: Props) {
	const [activities, setActivities] = useState<RoutineActivityType[]>(initialActivities)
	const [selectValue, setSelectValue] = useState("")

	// Sync state when initialActivities changes (e.g. React Router reuses component for different route)
	// biome-ignore lint/correctness/useExhaustiveDependencies: using JSON serialization as stable dependency
	useEffect(() => {
		setActivities(initialActivities)
	}, [JSON.stringify(initialActivities)])

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	)

	const handleAdd = useCallback(() => {
		if (!selectValue) return
		const activityType = selectValue as RoutineActivityType
		if (activities.includes(activityType)) return
		setActivities((prev) => [...prev, activityType])
		setSelectValue("")
	}, [selectValue, activities])

	const handleRemove = useCallback((activityType: RoutineActivityType) => {
		setActivities((prev) => prev.filter((a) => a !== activityType))
	}, [])

	function handleDragEnd(event: { active: { id: string | number }; over: { id: string | number } | null }) {
		const { active, over } = event
		if (!over || active.id === over.id) return

		setActivities((prev) => {
			const oldIndex = prev.indexOf(active.id as RoutineActivityType)
			const newIndex = prev.indexOf(over.id as RoutineActivityType)
			if (oldIndex === -1 || newIndex === -1) return prev
			const next = [...prev]
			next.splice(oldIndex, 1)
			next.splice(newIndex, 0, active.id as RoutineActivityType)
			return next
		})
	}

	// Available options: filter out already selected
	const availableGroups = ACTIVITY_TYPE_GROUPS.map((group) => ({
		...group,
		types: group.types.filter((t) => !activities.includes(t as RoutineActivityType)),
	})).filter((g) => g.types.length > 0)

	return (
		<VStack gap="space-8" id={id}>
			{/* Hidden input for form submission */}
			<input type="hidden" name={name} value={JSON.stringify(activities)} />

			{/* Sortable list */}
			{activities.length > 0 && (
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
					<SortableContext items={activities} strategy={verticalListSortingStrategy}>
						<VStack gap="space-4">
							{activities.map((activityType, index) => (
								<SortableActivityItem
									key={activityType}
									activityType={activityType}
									index={index}
									onRemove={() => handleRemove(activityType)}
									disabled={disabled}
								/>
							))}
						</VStack>
					</SortableContext>
				</DndContext>
			)}

			{/* Add new activity */}
			{!disabled && availableGroups.length > 0 && (
				<HStack gap="space-4" align="end">
					<Select
						label="Legg til vedlikeholdsaktivitet"
						size="small"
						value={selectValue}
						onChange={(e) => setSelectValue(e.target.value)}
						hideLabel={activities.length > 0}
					>
						<option value="">Velg aktivitet…</option>
						{availableGroups.map((group) => (
							<optgroup key={group.label} label={group.label}>
								{group.types.map((type) => (
									<option key={type} value={type}>
										{activityTypeLabels[type as RoutineActivityType]}
									</option>
								))}
							</optgroup>
						))}
					</Select>
					<Button
						type="button"
						size="small"
						variant="secondary"
						icon={<PlusIcon aria-hidden />}
						onClick={handleAdd}
						disabled={!selectValue}
					>
						Legg til
					</Button>
				</HStack>
			)}

			{activities.length === 0 && !disabled && (
				<BodyShort size="small" textColor="subtle">
					Ingen vedlikeholdsaktiviteter valgt. Gjennomganger vil ikke inkludere aktivitetssteg.
				</BodyShort>
			)}
		</VStack>
	)
}
