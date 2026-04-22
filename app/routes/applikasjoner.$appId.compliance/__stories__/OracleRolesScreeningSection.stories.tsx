import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { OracleRolesScreeningSection } from "../components/OracleRolesScreeningSection"

const mockRoles = [
	{ instanceId: "pensjon-db-01", roleName: "CONNECT", authType: "PASSWORD", common: true },
	{ instanceId: "pensjon-db-01", roleName: "DBA", authType: "PASSWORD", common: true },
	{ instanceId: "pensjon-db-01", roleName: "APP_USER", authType: null, common: false },
	{ instanceId: "pensjon-db-01", roleName: "BATCH_ROLE", authType: null, common: false },
	{ instanceId: "pensjon-db-02", roleName: "RESOURCE", authType: "EXTERNAL", common: true },
]

const mockAssessments: Record<string, { criticality: string; updatedBy: string; updatedAt: string }> = {
	"pensjon-db-01:CONNECT": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:30:00Z" },
	"pensjon-db-01:DBA": { criticality: "very_high", updatedBy: "A123456", updatedAt: "2026-04-15T10:31:00Z" },
	"pensjon-db-01:APP_USER": { criticality: "high", updatedBy: "A123456", updatedAt: "2026-04-15T10:32:00Z" },
	"pensjon-db-02:RESOURCE": { criticality: "medium", updatedBy: "B654321", updatedAt: "2026-04-16T08:00:00Z" },
}

const allAssessed: Record<string, { criticality: string; updatedBy: string; updatedAt: string }> = {
	...mockAssessments,
	"pensjon-db-01:BATCH_ROLE": { criticality: "medium", updatedBy: "A123456", updatedAt: "2026-04-17T09:00:00Z" },
}

function DataRouterWrapper({ children }: { children: React.ReactNode }) {
	const router = createMemoryRouter([{ path: "/", element: children }], { initialEntries: ["/"] })
	return <RouterProvider router={router} />
}

const meta = {
	title: "Komponenter/OracleRolesScreeningSection",
	component: OracleRolesScreeningSection,
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ maxWidth: "900px", padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
} satisfies Meta<typeof OracleRolesScreeningSection>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Delvis vurdert",
	args: {
		oracleRolesData: { roles: mockRoles, assessments: mockAssessments },
		questionId: "q-oracle-1",
		confirmed: false,
		canAdmin: true,
	},
}

export const AlleVurdert: Story = {
	name: "Alle roller vurdert",
	args: {
		oracleRolesData: { roles: mockRoles, assessments: allAssessed },
		questionId: "q-oracle-1",
		confirmed: false,
		canAdmin: true,
	},
}

export const Bekreftet: Story = {
	name: "Bekreftet",
	args: {
		oracleRolesData: { roles: mockRoles, assessments: allAssessed },
		questionId: "q-oracle-1",
		confirmed: true,
		canAdmin: true,
	},
}

export const IngenRoller: Story = {
	name: "Ingen roller",
	args: {
		oracleRolesData: { roles: [], assessments: {} },
		questionId: "q-oracle-1",
		confirmed: false,
		canAdmin: true,
	},
}

export const EnRolle: Story = {
	name: "Én rolle, ikke vurdert",
	args: {
		oracleRolesData: {
			roles: [{ instanceId: "pensjon-db-01", roleName: "APP_USER", authType: null, common: false }],
			assessments: {},
		},
		questionId: "q-oracle-1",
		confirmed: false,
		canAdmin: true,
	},
}

export const LeseModus: Story = {
	name: "Ikke-admin (lesemodus)",
	args: {
		oracleRolesData: { roles: mockRoles, assessments: allAssessed },
		questionId: "q-oracle-1",
		confirmed: false,
		canAdmin: false,
	},
}
