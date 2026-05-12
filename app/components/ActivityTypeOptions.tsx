import { ACTIVITY_TYPE_GROUPS, activityTypeLabels } from "~/lib/activity-types"

export function ActivityTypeOptions() {
	return (
		<>
			<option value="">Ingen</option>
			{ACTIVITY_TYPE_GROUPS.map((group) => (
				<optgroup key={group.label} label={group.label}>
					{group.types.map((type) => (
						<option key={type} value={type}>
							{activityTypeLabels[type]}
						</option>
					))}
				</optgroup>
			))}
		</>
	)
}
