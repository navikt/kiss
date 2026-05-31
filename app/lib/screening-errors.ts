export class ScreeningNotFoundError extends Error {
	constructor(message = "Screening-sesjon ikke funnet") {
		super(message)
		this.name = "ScreeningNotFoundError"
	}
}

export class ScreeningAlreadyCompletedError extends Error {
	constructor(message = "Kan ikke endre data i en fullført screening-sesjon") {
		super(message)
		this.name = "ScreeningAlreadyCompletedError"
	}
}

export class ScreeningConcurrentModificationError extends Error {
	constructor(message = "En annen bruker fullfører denne screeningen samtidig. Prøv igjen.") {
		super(message)
		this.name = "ScreeningConcurrentModificationError"
	}
}

export class ScreeningValidationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ScreeningValidationError"
	}
}

export class ScreeningReplayError extends Error {
	readonly intent: string
	constructor(intent: string, cause: string) {
		super(`Replay av «${intent}» feilet: ${cause}`)
		this.name = "ScreeningReplayError"
		this.intent = intent
	}
}
