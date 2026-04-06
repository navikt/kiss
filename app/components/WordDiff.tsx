import { diffWordsWithSpace } from "diff"
import type { ReactNode } from "react"

import "./word-diff.css"

interface WordDiffProps {
	/** The old (previous) value */
	oldValue: string | null
	/** The new (updated) value */
	newValue: string | null
	/** Which side to render: "old" highlights removals, "new" highlights additions */
	side: "old" | "new"
}

/**
 * Renders a word-level diff with IntelliJ-style highlighting.
 * On the "old" side, removed words get a red background.
 * On the "new" side, added words get a green background.
 * Unchanged text is rendered plain.
 */
export function WordDiff({ oldValue, newValue, side }: WordDiffProps) {
	const oldText = oldValue ?? ""
	const newText = newValue ?? ""

	if (oldText === "" && newText === "") {
		return <span className="word-diff--empty">(tom)</span>
	}

	if (oldText === newText) {
		return <>{side === "old" ? oldText : newText}</>
	}

	if (side === "old" && oldText === "") {
		return <span className="word-diff--empty">(tom)</span>
	}
	if (side === "new" && newText === "") {
		return <span className="word-diff--empty">(tom)</span>
	}

	const changes = diffWordsWithSpace(oldText, newText)
	const parts: ReactNode[] = []

	for (let i = 0; i < changes.length; i++) {
		const change = changes[i]

		if (!change.added && !change.removed) {
			parts.push(<span key={i}>{change.value}</span>)
		} else if (change.removed && side === "old") {
			parts.push(
				<span key={i} className="word-diff--removed">
					{change.value}
				</span>,
			)
		} else if (change.added && side === "new") {
			parts.push(
				<span key={i} className="word-diff--added">
					{change.value}
				</span>,
			)
		}
		// Skip: removed parts on "new" side and added parts on "old" side
	}

	return <span className="word-diff">{parts}</span>
}
