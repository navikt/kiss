import type { Meta, StoryObj } from "@storybook/react"
import { mockDomainData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import DomainDetail from "../index"

const meta = {
	title: "Sider/Kontrollrammeverk/Domene",
	component: DomainDetail,
} satisfies Meta<typeof DomainDetail>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => renderWithLoader(DomainDetail, mockDomainData(), "/kontrollrammeverk/ST"),
}
