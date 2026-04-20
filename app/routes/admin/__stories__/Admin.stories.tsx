import type { Meta, StoryObj } from "@storybook/react"
import { renderWithLoader } from "@storybook-mocks/router"
import Admin from "../index"

const meta = {
	title: "Sider/Admin",
	component: Admin,
} satisfies Meta<typeof Admin>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => renderWithLoader(Admin, null),
}
