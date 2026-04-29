import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { PersistenceSection } from "../components/PersistenceSection"

function DataRouterWrapper({ children }: { children: React.ReactNode }) {
	const router = createMemoryRouter([{ path: "/", element: children }], { initialEntries: ["/"] })
	return <RouterProvider router={router} />
}

const meta = {
	title: "Screening/PersistenceSection",
	component: PersistenceSection,
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ maxWidth: "900px", padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
} satisfies Meta<typeof PersistenceSection>
export default meta
type Story = StoryObj<typeof meta>

const mockEntries = [
	{
		id: "p-1",
		type: "cloud_sql_postgres" as const,
		name: "pensjon-sak-db",
		dataClassification: "critical" as const,
		manuallyAdded: false,
	},
	{
		id: "p-2",
		type: "oracle" as const,
		name: "PENSJON_DB_01",
		dataClassification: "financial_regulation" as const,
		manuallyAdded: false,
	},
	{ id: "p-3", type: "opensearch" as const, name: "pensjon-search", dataClassification: null, manuallyAdded: true },
]

export const DelvisKlassifisert: Story = {
	name: "Delvis klassifisert",
	args: {
		entries: mockEntries,
		questionId: "q-persistence-1",
		confirmed: false,
	},
}

export const AlleKlassifisert: Story = {
	name: "Alle klassifisert",
	args: {
		entries: [
			{
				id: "p-1",
				type: "cloud_sql_postgres" as const,
				name: "pensjon-sak-db",
				dataClassification: "critical" as const,
				manuallyAdded: false,
			},
			{
				id: "p-2",
				type: "oracle" as const,
				name: "PENSJON_DB_01",
				dataClassification: "financial_regulation" as const,
				manuallyAdded: false,
			},
			{
				id: "p-3",
				type: "opensearch" as const,
				name: "pensjon-search",
				dataClassification: "not_critical" as const,
				manuallyAdded: true,
			},
		],
		questionId: "q-persistence-1",
		confirmed: false,
	},
}

export const Bekreftet: Story = {
	name: "Bekreftet",
	args: {
		entries: [
			{
				id: "p-1",
				type: "cloud_sql_postgres" as const,
				name: "pensjon-sak-db",
				dataClassification: "critical" as const,
				manuallyAdded: false,
			},
			{
				id: "p-2",
				type: "oracle" as const,
				name: "PENSJON_DB_01",
				dataClassification: "financial_regulation" as const,
				manuallyAdded: false,
			},
		],
		questionId: "q-persistence-1",
		confirmed: true,
	},
}

export const IngenDatabaser: Story = {
	name: "Ingen databaser",
	args: {
		entries: [],
		questionId: "q-persistence-1",
		confirmed: false,
	},
}

export const ManueltLagtTil: Story = {
	name: "Med manuelt lagt til",
	args: {
		entries: [
			{
				id: "p-1",
				type: "cloud_sql_postgres" as const,
				name: "pensjon-sak-db",
				dataClassification: "critical" as const,
				manuallyAdded: false,
			},
			{ id: "p-4", type: "other" as const, name: "legacy-flatfil", dataClassification: null, manuallyAdded: true },
			{
				id: "p-5",
				type: "valkey" as const,
				name: "pensjon-cache",
				dataClassification: "not_critical" as const,
				manuallyAdded: true,
			},
		],
		questionId: "q-persistence-1",
		confirmed: false,
	},
}
