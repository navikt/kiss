import type { Meta, StoryObj } from "@storybook/react"
import { mockDeploymentStats } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import Dashboard from "../index"

const meta = {
	title: "Sider/Dashboard",
	component: Dashboard,
} satisfies Meta<typeof Dashboard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () =>
		renderWithLoader(Dashboard, {
			domainStatuses: [
				{
					code: "ST",
					name: "Sikkerhetstesting",
					implemented: 42,
					partial: 8,
					notImplemented: 5,
					notRelevant: 3,
					total: 58,
					controlCount: 12,
					controlsWithGaps: 3,
				},
				{
					code: "TS",
					name: "Tilgangsstyring",
					implemented: 35,
					partial: 12,
					notImplemented: 8,
					notRelevant: 5,
					total: 60,
					controlCount: 15,
					controlsWithGaps: 5,
				},
				{
					code: "PD",
					name: "Persondata",
					implemented: 28,
					partial: 6,
					notImplemented: 4,
					notRelevant: 2,
					total: 40,
					controlCount: 8,
					controlsWithGaps: 2,
				},
				{
					code: "EN",
					name: "Endringshåndtering",
					implemented: 20,
					partial: 10,
					notImplemented: 10,
					notRelevant: 0,
					total: 40,
					controlCount: 10,
					controlsWithGaps: 6,
				},
			],
			totalControls: 198,
			totalImplemented: 125,
			totalPartial: 36,
			totalMangler: 37,
			overallPercent: 65,
			deploymentStats: mockDeploymentStats(),
		}),
}

export const IngenData: Story = {
	name: "Ingen data",
	render: () =>
		renderWithLoader(Dashboard, {
			domainStatuses: [],
			totalControls: 0,
			totalImplemented: 0,
			totalPartial: 0,
			totalMangler: 0,
			overallPercent: 0,
			deploymentStats: {
				appsWithData: 0,
				fourEyesPercent: null,
				fourEyesTotal: 0,
				fourEyesApproved: 0,
				changeOriginPercent: null,
				changeOriginTotal: 0,
				changeOriginLinked: 0,
			},
		}),
}
