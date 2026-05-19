/** Field-level validation errors returned by routine create/edit actions */
export type RoutineFieldErrors = {
	name?: string
	frequency?: string
	sectionRoutineOwnerRole?: string
	activityTypes?: string
}
