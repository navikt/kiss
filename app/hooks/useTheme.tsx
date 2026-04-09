import { createContext, type ReactNode, useCallback, useContext, useState } from "react"
import { useFetcher } from "react-router"

type ThemeValue = "light" | "dark"

interface ThemeContextType {
	theme: ThemeValue
	setTheme: (theme: ThemeValue) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export function ThemeProvider({ children, initialTheme }: { children: ReactNode; initialTheme: ThemeValue }) {
	const [theme, setThemeState] = useState<ThemeValue>(initialTheme)
	const fetcher = useFetcher()

	const setTheme = useCallback(
		(newTheme: ThemeValue) => {
			setThemeState(newTheme)
			fetcher.submit({ theme: newTheme }, { method: "POST", action: "/" })
		},
		[fetcher],
	)

	return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
	const context = useContext(ThemeContext)
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider")
	}
	return context
}
