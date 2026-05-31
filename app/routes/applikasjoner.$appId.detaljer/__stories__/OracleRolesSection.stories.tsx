import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import type { OracleRoleDisplay } from "../components/OracleRolesSection"
import { OracleRolesSection } from "../components/OracleRolesSection"

const mockRoles: OracleRoleDisplay[] = [
	{
		instanceId: "pensjon-db-01",
		instanceName: "PENSJON_DB_01",
		roleName: "CONNECT",
		oracleMaintained: true,
		common: true,
		criticality: "low",
		updatedBy: "Z990001",
		updatedAt: "2026-04-15T10:30:00Z",
	},
	{
		instanceId: "pensjon-db-01",
		instanceName: "PENSJON_DB_01",
		roleName: "DBA",
		oracleMaintained: true,
		common: true,
		criticality: "very_high",
		updatedBy: "Z990001",
		updatedAt: "2026-04-15T10:31:00Z",
	},
	{
		instanceId: "pensjon-db-01",
		instanceName: "PENSJON_DB_01",
		roleName: "APP_USER",
		oracleMaintained: false,
		common: false,
		criticality: "high",
		updatedBy: "Z990001",
		updatedAt: "2026-04-15T10:32:00Z",
	},
	{
		instanceId: "pensjon-db-01",
		instanceName: "PENSJON_DB_01",
		roleName: "BATCH_ROLE",
		oracleMaintained: false,
		common: false,
		criticality: null,
		updatedBy: null,
		updatedAt: null,
	},
	{
		instanceId: "pensjon-db-02",
		instanceName: "PENSJON_DB_02",
		roleName: "RESOURCE",
		oracleMaintained: true,
		common: true,
		criticality: "medium",
		updatedBy: "Z990002",
		updatedAt: "2026-04-16T08:00:00Z",
	},
]

function DataRouterWrapper({ children }: { children: React.ReactNode }) {
	const router = createMemoryRouter([{ path: "/", element: children }], { initialEntries: ["/"] })
	return <RouterProvider router={router} />
}

const meta = {
	title: "Komponenter/OracleRolesSection",
	component: OracleRolesSection,
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ maxWidth: "900px", padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
} satisfies Meta<typeof OracleRolesSection>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		roles: mockRoles,
		canAdmin: false,
	},
}

export const Admin: Story = {
	args: {
		roles: mockRoles,
		canAdmin: true,
	},
}

export const Tomme: Story = {
	name: "Ingen roller",
	args: {
		roles: [],
		canAdmin: false,
	},
}

export const EnkeltRolle: Story = {
	name: "Én rolle, ikke vurdert",
	args: {
		roles: [
			{
				instanceId: "pensjon-db-01",
				instanceName: "PENSJON_DB_01",
				roleName: "APP_USER",
				oracleMaintained: false,
				common: false,
				criticality: null,
				updatedBy: null,
				updatedAt: null,
			},
		],
		canAdmin: true,
	},
}
