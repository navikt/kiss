import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { RulesetSection } from "../components/RulesetSection"

function DataRouterWrapper({ children }: { children: React.ReactNode }) {
	const router = createMemoryRouter([{ path: "/", element: children }], { initialEntries: ["/"] })
	return <RouterProvider router={router} />
}

const meta = {
	title: "Screening/RulesetSection",
	component: RulesetSection,
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ maxWidth: "700px", padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
} satisfies Meta<typeof RulesetSection>
export default meta
type Story = StoryObj<typeof meta>

const mockRulesets = [
	{ id: "rs-1", name: "Standard sikkerhetskrav" },
	{ id: "rs-2", name: "Personvern-krav" },
	{ id: "rs-3", name: "Tilgangsstyringskrav" },
]

export const Ubesvart: Story = {
	name: "Ubesvart",
	args: {
		question: {
			id: "q-ruleset-1",
			questionText: "Hvilket regelsett gjelder for denne applikasjonen?",
			description: "Velg det regelsettet som best beskriver kravene til applikasjonen.",
			descriptionHtml: "<p>Velg det regelsettet som best beskriver kravene til applikasjonen.</p>",
			displayOrder: 5,
			answerType: "ruleset",
			answer: null,
			answerComment: null,
			answerLink: null,
			answeredBy: null,
			answeredAt: null,
			choices: [],
			affectedControls: ["K-ST.01", "K-ST.02"],
		},
		rulesets: mockRulesets,
	},
}

export const Besvart: Story = {
	name: "Besvart",
	args: {
		question: {
			id: "q-ruleset-1",
			questionText: "Hvilket regelsett gjelder for denne applikasjonen?",
			description: "Velg det regelsettet som best beskriver kravene til applikasjonen.",
			descriptionHtml: "<p>Velg det regelsettet som best beskriver kravene til applikasjonen.</p>",
			displayOrder: 5,
			answerType: "ruleset",
			answer: "rs-1",
			answerComment: null,
			answerLink: null,
			answeredBy: "A123456",
			answeredAt: "2026-04-17T08:30:00Z",
			choices: [],
			affectedControls: ["K-ST.01", "K-ST.02"],
		},
		rulesets: mockRulesets,
	},
}

export const IngenRegelsett: Story = {
	name: "Ingen regelsett tilgjengelig",
	args: {
		question: {
			id: "q-ruleset-1",
			questionText: "Hvilket regelsett gjelder for denne applikasjonen?",
			description: "",
			descriptionHtml: "",
			displayOrder: 5,
			answerType: "ruleset",
			answer: null,
			answerComment: null,
			answerLink: null,
			answeredBy: null,
			answeredAt: null,
			choices: [],
			affectedControls: [],
		},
		rulesets: [],
	},
}
