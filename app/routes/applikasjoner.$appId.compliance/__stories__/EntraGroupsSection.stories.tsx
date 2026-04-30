import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { EntraGroupsSection } from "../components/EntraGroupsSection"

function Wrapper({ children }: { children: React.ReactNode }) {
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: children,
				loader: () => null,
			},
			{
				path: "/api/graph/groups",
				loader: () => ({
					results: [
						{ id: "g-new-1", displayName: "ny-gruppe-fra-søk" },
						{ id: "g-new-2", displayName: "annen-gruppe" },
					],
				}),
			},
		],
		{ initialEntries: ["/"] },
	)
	return <RouterProvider router={router} />
}

const meta = {
	title: "Screening/EntraGroupsSection",
	component: EntraGroupsSection,
	decorators: [
		(Story) => (
			<Wrapper>
				<div style={{ maxWidth: "900px", padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</Wrapper>
		),
	],
} satisfies Meta<typeof EntraGroupsSection>
export default meta
type Story = StoryObj<typeof meta>

const mockEntraGroupsData = {
	naisGroupIds: ["g-1", "g-2"],
	manualGroups: [
		{
			id: "mg-1",
			groupId: "g-3",
			groupName: "manuell-admin-gruppe",
			createdBy: "A123456",
			createdAt: "2026-04-10T08:00:00Z",
		},
	],
	ghostGroupIds: ["g-old"],
	groupNames: {
		"g-1": "pensjon-sak-read",
		"g-2": "pensjon-sak-admin",
		"g-old": "fjernet-fra-manifest",
	} as Record<string, string>,
	assessmentsByGroupId: {
		"g-1": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:00:00Z" },
		"g-2": { criticality: "high", updatedBy: "A123456", updatedAt: "2026-04-15T10:05:00Z" },
	} as Record<string, { criticality: string; updatedBy: string; updatedAt: string }>,
}

export const Default: Story = {
	name: "Med grupper fra flere kilder",
	args: {
		entraGroupsData: mockEntraGroupsData,
		questionId: "q-entra-1",
		confirmed: false,
	},
}

export const AlleVurdert: Story = {
	name: "Alle grupper vurdert",
	args: {
		entraGroupsData: {
			...mockEntraGroupsData,
			ghostGroupIds: [],
			assessmentsByGroupId: {
				"g-1": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:00:00Z" },
				"g-2": { criticality: "high", updatedBy: "A123456", updatedAt: "2026-04-15T10:05:00Z" },
				"g-3": { criticality: "medium", updatedBy: "B654321", updatedAt: "2026-04-16T09:00:00Z" },
			},
		},
		questionId: "q-entra-1",
		confirmed: false,
	},
}

export const Bekreftet: Story = {
	name: "Bekreftet",
	args: {
		entraGroupsData: {
			naisGroupIds: ["g-1", "g-2"],
			manualGroups: [],
			ghostGroupIds: [],
			groupNames: {
				"g-1": "pensjon-sak-read",
				"g-2": "pensjon-sak-admin",
			},
			assessmentsByGroupId: {
				"g-1": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:00:00Z" },
				"g-2": { criticality: "high", updatedBy: "A123456", updatedAt: "2026-04-15T10:05:00Z" },
			},
		},
		questionId: "q-entra-1",
		confirmed: true,
	},
}

export const IngenGrupper: Story = {
	name: "Ingen grupper",
	args: {
		entraGroupsData: {
			naisGroupIds: [],
			manualGroups: [],
			ghostGroupIds: [],
			groupNames: {},
			assessmentsByGroupId: {},
		},
		questionId: "q-entra-1",
		confirmed: false,
	},
}

export const KunNaisGrupper: Story = {
	name: "Kun Nais-grupper",
	args: {
		entraGroupsData: {
			naisGroupIds: ["g-1", "g-2", "g-4"],
			manualGroups: [],
			ghostGroupIds: [],
			groupNames: {
				"g-1": "pensjon-sak-read",
				"g-2": "pensjon-sak-admin",
				"g-4": "pensjon-sak-deploy",
			},
			assessmentsByGroupId: {
				"g-1": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:00:00Z" },
			},
		},
		questionId: "q-entra-1",
		confirmed: false,
	},
}
