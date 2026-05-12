import type { Meta, StoryObj } from "@storybook/react"
import { MemoryRouter } from "react-router"
import { AppNavigation } from "../../components/AppNavigation"

const meta = {
	title: "Components/AppNavigation",
	component: AppNavigation,
	args: {
		isAdmin: false,
		sections: [],
		teams: [],
	},
	decorators: [
		(Story: React.ComponentType) => (
			<MemoryRouter initialEntries={["/"]}>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof AppNavigation>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const ActiveDashboard: Story = {}

export const ActiveKontrollrammeverk: Story = {}

export const WithSection: Story = {
	args: {
		sections: [{ sectionName: "Pensjon og uføre", sectionSlug: "pensjon-og-ufore" }],
	},
}

export const WithSectionAndTeam: Story = {
	args: {
		sections: [{ sectionName: "Pensjon og uføre", sectionSlug: "pensjon-og-ufore" }],
		teams: [{ teamName: "Team Pensjonsgivende", teamSlug: "team-pensjonsgivende", sectionSlug: "pensjon-og-ufore" }],
	},
}

export const WithMultipleTeams: Story = {
	args: {
		sections: [{ sectionName: "Pensjon og uføre", sectionSlug: "pensjon-og-ufore" }],
		teams: [
			{
				teamName: "Team Pensjonsgivende",
				teamSlug: "team-pensjonsgivende",
				sectionSlug: "pensjon-og-ufore",
			},
			{ teamName: "Team Uføretrygd", teamSlug: "team-uforetrygd", sectionSlug: "pensjon-og-ufore" },
		],
	},
}
