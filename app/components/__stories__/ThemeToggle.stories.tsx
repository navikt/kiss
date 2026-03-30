import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { ThemeToggle } from "../../components/ThemeToggle"

function ThemeToggleWrapper({ theme }: { theme: "light" | "dark" }) {
	const router = createMemoryRouter(
		[
			{
				id: "root",
				path: "/",
				loader: () => ({ theme, user: null }),
				Component: ThemeToggle,
			},
		],
		{ initialEntries: ["/"] },
	)

	return <RouterProvider router={router} />
}

const meta = {
	title: "Components/ThemeToggle",
	component: ThemeToggleWrapper,
	argTypes: {
		theme: {
			control: "radio",
			options: ["light", "dark"],
		},
	},
} satisfies Meta<typeof ThemeToggleWrapper>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = {
	args: { theme: "light" },
}

export const Dark: Story = {
	args: { theme: "dark" },
}
