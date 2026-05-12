import type { Meta, StoryObj } from "@storybook/react"
import { renderWithLoader } from "@storybook-mocks/router"
import AdminBrukere from "../index"

const meta = {
	title: "Sider/Admin/Brukere",
	component: AdminBrukere,
} satisfies Meta<typeof AdminBrukere>
export default meta
type Story = StoryObj<typeof meta>

const mockUsers = [
	{
		id: "u1",
		navIdent: "A123456",
		name: "Arne Arnesen",
		email: "arne.arnesen@nav.no",
		lastLoginAt: "2026-05-10T08:30:00Z",
		roles: [
			{
				id: "r1",
				role: "admin" as const,
				sectionId: null,
				sectionName: null,
				sectionSlug: null,
				devTeamId: null,
				devTeamName: null,
				devTeamSlug: null,
				devTeamSectionId: null,
				createdAt: "2026-01-01T00:00:00Z",
				createdBy: "SYSTEM",
			},
		],
	},
	{
		id: "u2",
		navIdent: "B654321",
		name: "Berit Berntsen",
		email: "berit.berntsen@nav.no",
		lastLoginAt: "2026-05-11T14:15:00Z",
		roles: [
			{
				id: "r2",
				role: "tech_manager" as const,
				sectionId: "s1",
				sectionName: "Pensjon og uføre",
				sectionSlug: "pensjon-og-ufore",
				devTeamId: null,
				devTeamName: null,
				devTeamSlug: null,
				devTeamSectionId: null,
				createdAt: "2026-02-15T00:00:00Z",
				createdBy: "A123456",
			},
			{
				id: "r3",
				role: "section_manager" as const,
				sectionId: "s1",
				sectionName: "Pensjon og uføre",
				sectionSlug: "pensjon-og-ufore",
				devTeamId: null,
				devTeamName: null,
				devTeamSlug: null,
				devTeamSectionId: null,
				createdAt: "2026-03-01T00:00:00Z",
				createdBy: "A123456",
			},
		],
	},
	{
		id: "u3",
		navIdent: "C111222",
		name: "Carl Carlsen",
		email: null,
		lastLoginAt: null,
		roles: [],
	},
	{
		id: "u4",
		navIdent: "D333444",
		name: "Dina Didriksen",
		email: "dina.didriksen@nav.no",
		lastLoginAt: "2026-05-12T07:00:00Z",
		roles: [
			{
				id: "r4",
				role: "developer" as const,
				sectionId: null,
				sectionName: null,
				sectionSlug: null,
				devTeamId: "t1",
				devTeamName: "Team Pensjon",
				devTeamSlug: "team-pensjon",
				devTeamSectionId: "s1",
				createdAt: "2026-04-01T00:00:00Z",
				createdBy: "A123456",
			},
		],
	},
]

const mockSections = [
	{ id: "s1", name: "Pensjon og uføre" },
	{ id: "s2", name: "Arbeid og ytelser" },
]

const mockTeams = [
	{ id: "t1", name: "Team Pensjon", sectionId: "s1" },
	{ id: "t2", name: "Team Dagpenger", sectionId: "s2" },
]

export const Default: Story = {
	render: () =>
		renderWithLoader(AdminBrukere, {
			users: mockUsers,
			sections: mockSections,
			teams: mockTeams,
		}),
}

export const Empty: Story = {
	render: () =>
		renderWithLoader(AdminBrukere, {
			users: [],
			sections: mockSections,
			teams: mockTeams,
		}),
}
