import { Theme } from "@navikt/ds-react"
import type { Decorator, Preview } from "@storybook/react"
import "@navikt/ds-css/dist/index.css"
import "../app/styles/global.css"

const withTheme: Decorator = (Story, context) => {
	const theme = context.globals.theme || "light"
	return (
		<Theme theme={theme}>
			<Story />
		</Theme>
	)
}

const preview: Preview = {
	globalTypes: {
		theme: {
			description: "Aksel theme (light/dark)",
			toolbar: {
				title: "Theme",
				icon: "circlehollow",
				items: [
					{ value: "light", icon: "sun", title: "Light" },
					{ value: "dark", icon: "moon", title: "Dark" },
				],
				dynamicTitle: true,
			},
		},
	},
	initialGlobals: {
		theme: "light",
	},
	parameters: {
		viewport: {
			options: {
				mobile: {
					name: "Mobil (375px)",
					styles: { width: "375px", height: "667px" },
				},
				tablet: {
					name: "Nettbrett (768px)",
					styles: { width: "768px", height: "1024px" },
				},
				desktop: {
					name: "Desktop (1280px)",
					styles: { width: "1280px", height: "800px" },
				},
			},
		},
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		options: {
			storySort: {
				method: "alphabetical",
			},
		},
	},
	decorators: [withTheme],
}

export default preview
