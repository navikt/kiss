import type { Meta, StoryObj } from "@storybook/react"
import { MemoryRouter } from "react-router"
import type { OracleProfileDisplay } from "../components/OracleProfilesSection"
import { OracleProfilesSection } from "../components/OracleProfilesSection"

const mockProfiles: OracleProfileDisplay[] = [
	{
		instanceId: "pensjon-db-01",
		instanceName: "PENSJON_DB_01",
		profileName: "DEFAULT",
		criticality: "low",
		updatedBy: "A123456",
		updatedAt: "2026-04-15T10:30:00Z",
	},
	{
		instanceId: "pensjon-db-01",
		instanceName: "PENSJON_DB_01",
		profileName: "APP_USER",
		criticality: "high",
		updatedBy: "A123456",
		updatedAt: "2026-04-15T10:31:00Z",
	},
	{
		instanceId: "pensjon-db-01",
		instanceName: "PENSJON_DB_01",
		profileName: "BATCH_USER",
		criticality: null,
		updatedBy: null,
		updatedAt: null,
	},
	{
		instanceId: "pensjon-db-02",
		instanceName: "PENSJON_DB_02",
		profileName: "DEFAULT",
		criticality: "medium",
		updatedBy: "B654321",
		updatedAt: "2026-04-16T08:00:00Z",
	},
	{
		instanceId: "pensjon-db-02",
		instanceName: "PENSJON_DB_02",
		profileName: "CONNECT",
		criticality: "very_high",
		updatedBy: "B654321",
		updatedAt: "2026-04-16T08:01:00Z",
	},
]

const meta = {
	title: "Komponenter/OracleProfilesSection",
	component: OracleProfilesSection,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<div style={{ maxWidth: "900px", padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof OracleProfilesSection>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		profiles: mockProfiles,
		canAdmin: false,
	},
}

export const Admin: Story = {
	args: {
		profiles: mockProfiles,
		canAdmin: true,
	},
}

export const Tomme: Story = {
	name: "Ingen profiler",
	args: {
		profiles: [],
		canAdmin: false,
	},
}

export const EnkeltProfil: Story = {
	name: "Én profil, ikke vurdert",
	args: {
		profiles: [
			{
				instanceId: "pensjon-db-01",
				instanceName: "PENSJON_DB_01",
				profileName: "DEFAULT",
				criticality: null,
				updatedBy: null,
				updatedAt: null,
			},
		],
		canAdmin: true,
	},
}
