import { Label, Textarea, type TextareaProps } from "@navikt/ds-react"
import { useState } from "react"
import { MarkdownHint } from "./MarkdownHint"
import { MarkdownPreview } from "./MarkdownPreview"

interface MarkdownEditorProps {
	/** Label shown above the textarea. */
	label: string
	/** The `name` attribute for the textarea (used in form submission). */
	name: string
	/** Initial/default value. */
	defaultValue?: string
	/** Textarea size variant. */
	size?: TextareaProps["size"]
	/** Minimum visible rows. */
	minRows?: number
}

/**
 * Side-by-side markdown editor with live preview.
 * The textarea and preview box are always the same height.
 */
export function MarkdownEditor({ label, name, defaultValue = "", size = "small", minRows = 6 }: MarkdownEditorProps) {
	const [preview, setPreview] = useState(defaultValue)

	return (
		<div className="markdown-editor">
			<div className="markdown-editor__pane">
				<Textarea
					label={label}
					name={name}
					defaultValue={defaultValue}
					size={size}
					minRows={minRows}
					onChange={(e) => setPreview(e.target.value)}
				/>
				<MarkdownHint />
			</div>
			<div className="markdown-editor__pane">
				<Label size={size} spacing>
					Forhåndsvisning
				</Label>
				<MarkdownPreview content={preview} />
			</div>
		</div>
	)
}
