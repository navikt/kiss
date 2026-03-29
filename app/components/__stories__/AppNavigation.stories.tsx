import type { Meta, StoryObj } from "@storybook/react"
import { MemoryRouter } from "react-router"
import { AppNavigation } from "../../components/AppNavigation"

const meta = {
	title: "Components/AppNavigation",
	component: AppNavigation,
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
