export interface PendingEffectItem {
	clientId: string
	controlTextId: string
	controlName: string
	effect: string | null
	comment: string | null
}

export interface PendingChoice {
	clientId: string
	label: string
	requiresComment: boolean
	requiresLink: boolean
	displayOrder: number
	effects: PendingEffectItem[]
}

export type ServerChoice = {
	id: string
	label: string
	requiresComment: boolean
	requiresLink: boolean
	effects: Array<{
		id: string
		controlTextId: string
		controlName: string | null
		effect: string | null
		comment: string | null
	}>
}

export type ControlOption = { controlId: string; name: string }

export type DeleteTarget = {
	type: "choice" | "effect"
	id: string
	label: string
	choiceId?: string
}
