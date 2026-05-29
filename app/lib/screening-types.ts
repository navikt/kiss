export interface PendingEffectItem {
	clientId: string
	controlTextId: string
	controlName: string
	effect: string | null
	comment: string | null
	presetRoutineId: string | null
}

export interface PendingChoice {
	clientId: string
	label: string
	requiresComment: boolean
	requiresLink: boolean
	displayOrder: number
	effects: PendingEffectItem[]
}

/**
 * Kastes av addChoiceEffect for kjente valideringsfeil (ugyldig input).
 * Skiller disse fra uventede DB-/nettverksfeil som skal gi 500.
 */
export class ScreeningValidationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ScreeningValidationError"
	}
}
