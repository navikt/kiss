import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DragVerticalIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Box,
	Button,
	Checkbox,
	CheckboxGroup,
	HStack,
	Select,
	Tag,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useCallback, useEffect, useId, useState } from "react"
import { ACTIVITY_TYPE_GROUPS, activityTypeLabels, type RoutineActivityType } from "~/lib/activity-types"
import { STEP_COMPONENT_TYPES, type StepComponent } from "~/lib/manual-activity-staged-data"
import { MarkdownEditor } from "./MarkdownEditor"

const stepComponentLabels: Record<string, string> = {
	notater: "Notater",
	lenker: "Lenker",
	vedlegg: "Vedlegg",
}

export type ActivityItem = {
	/** Stable client-side key for React reconciliation */
	id: string
	type: RoutineActivityType
	/** Title — only used for manual_activity items */
	stepTitle?: string
	/** Description — only used for manual_activity items */
	stepDescription?: string
	/** Configured UI components for this step — only used for manual_activity items */
	stepComponents?: StepComponent[]
}

type Props = {
	/** Currently selected activity items (ordered) */
	initialActivities?: ActivityItem[]
	/** Form field name for hidden input containing JSON array */
	name?: string
	/** Whether editing is disabled */
	disabled?: boolean
	/** Id used by ErrorSummary anchor links */
	id?: string
	/** Callback fired when the activities list changes */
	onActivitiesChange?: (activities: ActivityItem[]) => void
}

let nextKey = 0
function genKey() {
	return `item-${++nextKey}`
}

function SortableActivityItem({
	item,
	index,
	onRemove,
	onChange,
	disabled,
}: {
	item: ActivityItem
	index: number
	onRemove: () => void
	onChange: (updated: Partial<ActivityItem>) => void
	disabled?: boolean
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: item.id,
		disabled,
	})

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	}

	const isManualActivity = item.type === "manual_activity"

	const selectedComponentTypes = new Set((item.stepComponents ?? []).map((c) => c.type))

	function handleComponentToggle(type: string, checked: boolean) {
		const current = item.stepComponents ?? []
		if (checked) {
			onChange({ stepComponents: [...current, { type: type as StepComponent["type"], required: false }] })
		} else {
			onChange({ stepComponents: current.filter((c) => c.type !== type) })
		}
	}

	function handleComponentRequiredToggle(type: string, required: boolean) {
		const current = item.stepComponents ?? []
		onChange({ stepComponents: current.map((c) => (c.type === type ? { ...c, required } : c)) })
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
			<VStack gap="space-4">
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
								aria-label={`Dra for å endre rekkefølge: ${activityTypeLabels[item.type]}`}
							>
								<DragVerticalIcon aria-hidden fontSize="1.25rem" />
							</button>
						)}
						<Tag variant="neutral" size="small">
							#{index + 1}
						</Tag>
						<BodyShort size="small">{activityTypeLabels[item.type]}</BodyShort>
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

				{isManualActivity && (
					<VStack gap="space-4">
						<TextField
							label="Tittel på steg"
							size="small"
							value={item.stepTitle ?? ""}
							onChange={(e) => onChange({ stepTitle: e.target.value })}
							disabled={disabled}
						/>
						<MarkdownEditor
							label="Beskrivelse (valgfri)"
							name={`stepDescription-${item.id}`}
							value={item.stepDescription ?? ""}
							onChange={(val) => onChange({ stepDescription: val })}
							size="small"
							minRows={2}
						/>
						<VStack gap="space-2">
							<CheckboxGroup legend="Komponenter som vises i gjennomgangen" size="small" disabled={disabled}>
								{STEP_COMPONENT_TYPES.map((type) => {
									const isSelected = selectedComponentTypes.has(type)
									const comp = (item.stepComponents ?? []).find((c) => c.type === type)
									return (
										<VStack key={type} gap="space-1">
											<Checkbox
												value={type}
												checked={isSelected}
												onChange={(e) => handleComponentToggle(type, e.target.checked)}
											>
												{stepComponentLabels[type] ?? type}
											</Checkbox>
											{isSelected && (
												<Box paddingInline="space-8">
													<Checkbox
														size="small"
														checked={comp?.required ?? false}
														onChange={(e) => handleComponentRequiredToggle(type, e.target.checked)}
													>
														Påkrevd
													</Checkbox>
												</Box>
											)}
										</VStack>
									)
								})}
							</CheckboxGroup>
						</VStack>
					</VStack>
				)}
			</VStack>
		</Box>
	)
}

export function SortableActivityList({
	initialActivities = [],
	name = "activityItems",
	disabled = false,
	id,
	onActivitiesChange,
}: Props) {
	const fallbackId = useId()
	const listId = id ?? fallbackId
	const [activities, setActivities] = useState<ActivityItem[]>(initialActivities)
	const [selectValue, setSelectValue] = useState("")

	// biome-ignore lint/correctness/useExhaustiveDependencies: JSON serialization as stable dep
	useEffect(() => {
		setActivities(initialActivities)
	}, [JSON.stringify(initialActivities)])

	const notifyChange = useCallback(
		(updated: ActivityItem[]) => {
			onActivitiesChange?.(updated)
		},
		[onActivitiesChange],
	)

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	)

	const handleAdd = useCallback(() => {
		if (!selectValue) return
		const type = selectValue as RoutineActivityType
		const newItem: ActivityItem =
			type === "manual_activity"
				? { id: genKey(), type, stepTitle: "", stepDescription: "", stepComponents: [] }
				: { id: type, type }
		const updated = [...activities, newItem]
		setActivities(updated)
		notifyChange(updated)
		setSelectValue("")
	}, [selectValue, activities, notifyChange])

	const handleRemove = useCallback(
		(itemId: string) => {
			const updated = activities.filter((a) => a.id !== itemId)
			setActivities(updated)
			notifyChange(updated)
		},
		[activities, notifyChange],
	)

	const handleChange = useCallback(
		(itemId: string, patch: Partial<ActivityItem>) => {
			const updated = activities.map((a) => (a.id === itemId ? { ...a, ...patch } : a))
			setActivities(updated)
			notifyChange(updated)
		},
		[activities, notifyChange],
	)

	function handleDragEnd(event: { active: { id: string | number }; over: { id: string | number } | null }) {
		const { active, over } = event
		if (!over || active.id === over.id) return

		setActivities((prev) => {
			const oldIndex = prev.findIndex((a) => a.id === active.id)
			const newIndex = prev.findIndex((a) => a.id === over.id)
			if (oldIndex === -1 || newIndex === -1) return prev
			const next = [...prev]
			next.splice(oldIndex, 1)
			next.splice(newIndex, 0, prev[oldIndex])
			notifyChange(next)
			return next
		})
	}

	// For non-checklist types: filter out already selected. manual_activity can always be added again.
	const selectedNonManualActivity = new Set(activities.filter((a) => a.type !== "manual_activity").map((a) => a.type))
	const availableGroups = ACTIVITY_TYPE_GROUPS.map((group) => ({
		...group,
		types: group.types.filter(
			(t) => t === "manual_activity" || !selectedNonManualActivity.has(t as RoutineActivityType),
		),
	})).filter((g) => g.types.length > 0)

	return (
		<VStack gap="space-8" id={listId}>
			<input
				type="hidden"
				name={name}
				value={JSON.stringify(
					activities.map((a) => ({
						id: a.id,
						type: a.type,
						...(a.type === "manual_activity" && {
							stepTitle: a.stepTitle ?? "",
							stepDescription: a.stepDescription ?? null,
							// undefined → omitted from JSON (legacy, no config) vs [] → explicit zero
							stepComponents: a.stepComponents,
						}),
					})),
				)}
			/>

			{activities.length > 0 && (
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
					<SortableContext items={activities.map((a) => a.id)} strategy={verticalListSortingStrategy}>
						<VStack gap="space-4">
							{activities.map((item, index) => (
								<SortableActivityItem
									key={item.id}
									item={item}
									index={index}
									onRemove={() => handleRemove(item.id)}
									onChange={(patch) => handleChange(item.id, patch)}
									disabled={disabled}
								/>
							))}
						</VStack>
					</SortableContext>
				</DndContext>
			)}

			{!disabled && availableGroups.length > 0 && (
				<HStack gap="space-4" align="end">
					<Select
						label="Legg til vedlikeholdsaktivitet"
						size="small"
						value={selectValue}
						onChange={(e) => setSelectValue(e.target.value)}
						hideLabel
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
