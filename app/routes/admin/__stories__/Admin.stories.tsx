import type { Meta, StoryObj } from "@storybook/react"
import { renderWithLoader } from "@storybook-mocks/router"
import Admin from "../index"

const meta: Meta = {
	title: "Sider/Admin",
	component: Admin,
}
export default meta
type Story = StoryObj

export const Default: Story = {
	render: () => renderWithLoader(Admin, null),
}
