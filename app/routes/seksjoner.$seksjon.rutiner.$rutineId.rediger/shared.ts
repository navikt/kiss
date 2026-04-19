export const PREDEFINED_ROLES = [
	"Seksjonsleder",
	"Teknologileder",
	"Teamleder",
	"Utvikler",
	"Arkitekt",
	"Sikkerhetsansvarlig",
	"Testleder",
] as const

export type PredefinedRole = (typeof PREDEFINED_ROLES)[number]

export interface QuestionLink {
	key: string
	questionId: string
	choiceValue: string
}

export interface PersistenceLinkItem {
	key: string
	persistenceType: string
	dataClassification: string
}
