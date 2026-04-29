import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { ScreeningAnswerForm } from "../components/ScreeningAnswerForm"

function DataRouterWrapper({ children }: { children: React.ReactNode }) {
	const router = createMemoryRouter([{ path: "/", element: children }], { initialEntries: ["/"] })
	return <RouterProvider router={router} />
}

const meta = {
	title: "Screening/ScreeningAnswerForm",
	component: ScreeningAnswerForm,
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ maxWidth: "700px", padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
} satisfies Meta<typeof ScreeningAnswerForm>
export default meta
type Story = StoryObj<typeof meta>

export const BooleanUbesvart: Story = {
	name: "Boolean – Ubesvart",
	args: {
		question: {
			id: "q-1",
			questionText: "Behandler applikasjonen personopplysninger?",
			description: "Svaret påvirker om DPIA-relaterte kontrollpunkter er relevante.",
			descriptionHtml: "<p>Svaret påvirker om DPIA-relaterte kontrollpunkter er relevante.</p>",
			displayOrder: 0,
			answerType: "boolean",
			answer: null,
			answerComment: null,
			answerLink: null,
			answeredBy: null,
			answeredAt: null,
			choices: [
				{ id: "c-1", label: "Ja", requiresComment: false, requiresLink: false, routineSelections: [] },
				{ id: "c-2", label: "Nei", requiresComment: false, requiresLink: false, routineSelections: [] },
			],
			affectedControls: ["K-PD.01", "K-PD.02"],
		},
	},
}

export const BooleanBesvart: Story = {
	name: "Boolean – Besvart",
	args: {
		question: {
			id: "q-1",
			questionText: "Behandler applikasjonen personopplysninger?",
			description: "Svaret påvirker om DPIA-relaterte kontrollpunkter er relevante.",
			descriptionHtml: "<p>Svaret påvirker om DPIA-relaterte kontrollpunkter er relevante.</p>",
			displayOrder: 0,
			answerType: "boolean",
			answer: "Ja",
			answerComment: null,
			answerLink: null,
			answeredBy: "A123456",
			answeredAt: "2026-04-15T10:30:00Z",
			choices: [
				{ id: "c-1", label: "Ja", requiresComment: false, requiresLink: false, routineSelections: [] },
				{ id: "c-2", label: "Nei", requiresComment: false, requiresLink: false, routineSelections: [] },
			],
			affectedControls: ["K-PD.01", "K-PD.02"],
		},
	},
}

export const BooleanMedKommentar: Story = {
	name: "Boolean – Krever kommentar",
	args: {
		question: {
			id: "q-comment",
			questionText: "Er applikasjonen underlagt spesielle regulatoriske krav?",
			description: "Beskriv hvilke regulatoriske krav som gjelder.",
			descriptionHtml: "<p>Beskriv hvilke regulatoriske krav som gjelder.</p>",
			displayOrder: 1,
			answerType: "boolean",
			answer: "Ja",
			answerComment: "Underlagt GDPR og ePrivacy-direktivet",
			answerLink: null,
			answeredBy: "A123456",
			answeredAt: "2026-04-20T09:00:00Z",
			choices: [
				{ id: "c-3", label: "Ja", requiresComment: true, requiresLink: true, routineSelections: [] },
				{ id: "c-4", label: "Nei", requiresComment: false, requiresLink: false, routineSelections: [] },
			],
			affectedControls: ["K-PD.01"],
		},
	},
}

export const SingleChoiceUbesvart: Story = {
	name: "Single choice – Ubesvart",
	args: {
		question: {
			id: "q-5",
			questionText: "Er applikasjonen eksponert eksternt?",
			description: null,
			descriptionHtml: "",
			displayOrder: 4,
			answerType: "single_choice",
			answer: null,
			answerComment: null,
			answerLink: null,
			answeredBy: null,
			answeredAt: null,
			choices: [
				{
					id: "c-5",
					label: "Ja, tilgjengelig for eksterne brukere",
					requiresComment: false,
					requiresLink: false,
					routineSelections: [],
				},
				{ id: "c-6", label: "Kun intern tilgang", requiresComment: false, requiresLink: false, routineSelections: [] },
				{
					id: "c-7",
					label: "Kun tilgjengelig for partnere",
					requiresComment: true,
					requiresLink: false,
					routineSelections: [],
				},
			],
			affectedControls: ["K-ST.01"],
		},
	},
}

export const SingleChoiceBesvart: Story = {
	name: "Single choice – Besvart",
	args: {
		question: {
			id: "q-5",
			questionText: "Er applikasjonen eksponert eksternt?",
			description: null,
			descriptionHtml: "",
			displayOrder: 4,
			answerType: "single_choice",
			answer: "Kun intern tilgang",
			answerComment: null,
			answerLink: null,
			answeredBy: "B654321",
			answeredAt: "2026-04-16T14:00:00Z",
			choices: [
				{
					id: "c-5",
					label: "Ja, tilgjengelig for eksterne brukere",
					requiresComment: false,
					requiresLink: false,
					routineSelections: [],
				},
				{ id: "c-6", label: "Kun intern tilgang", requiresComment: false, requiresLink: false, routineSelections: [] },
				{
					id: "c-7",
					label: "Kun tilgjengelig for partnere",
					requiresComment: true,
					requiresLink: false,
					routineSelections: [],
				},
			],
			affectedControls: ["K-ST.01"],
		},
	},
}

export const BooleanMedRutinevalg: Story = {
	name: "Boolean – Med rutinevalg",
	args: {
		question: {
			id: "q-routine",
			questionText: "Bruker applikasjonen tilgangsstyring via AD-grupper?",
			description: "Hvis ja, må du velge rutine for tilgangskontroll.",
			descriptionHtml: "<p>Hvis ja, må du velge rutine for tilgangskontroll.</p>",
			displayOrder: 2,
			answerType: "boolean",
			answer: "Ja",
			answerComment: null,
			answerLink: null,
			answeredBy: "A123456",
			answeredAt: "2026-04-18T11:00:00Z",
			choices: [
				{
					id: "c-8",
					label: "Ja",
					requiresComment: false,
					requiresLink: false,
					routineSelections: [
						{
							effectId: "eff-1",
							controlTextId: "K-TS.01",
							controlName: "Tilgangskontroll og autorisering",
							selectedRoutineId: null,
							routines: [
								{ id: "r-1", name: "Tilgangsgjennomgang kvartalsvis", sectionId: "s-01" },
								{ id: "r-2", name: "AD-gruppe-revisjon halvårlig", sectionId: "s-01" },
							],
						},
					],
				},
				{ id: "c-9", label: "Nei", requiresComment: false, requiresLink: false, routineSelections: [] },
			],
			affectedControls: ["K-TS.01"],
		},
	},
}
