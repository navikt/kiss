import { Label, Textarea, type TextareaProps } from "@navikt/ds-react"
import { useState } from "react"
import { MarkdownHint } from "./MarkdownHint"
import { MarkdownPreview } from "./MarkdownPreview"

interface MarkdownEditorProps {
	/** Label shown above the textarea. */
	label: string
	/** The `name` attribute for the textarea (used in form submission). */
	name: string
	/** Initial/default value (uncontrolled). Ignored when `value` is provided. */
	defaultValue?: string
	/** Controlled value. When provided, `onChange` must also be provided. */
	value?: string
	/** Change handler for controlled mode. */
	onChange?: (value: string) => void
	/** Textarea size variant. */
	size?: TextareaProps["size"]
	/** Minimum visible rows. */
	minRows?: number
}

/**
 * Side-by-side markdown editor with live preview.
 * The textarea and preview box are always the same height.
 * Supports both controlled (`value`/`onChange`) and uncontrolled (`defaultValue`) modes.
 */
export function MarkdownEditor({
	label,
	name,
	defaultValue = "",
	value,
	onChange,
	size = "small",
	minRows = 6,
}: MarkdownEditorProps) {
	const isControlled = value !== undefined
	const [internalPreview, setInternalPreview] = useState(defaultValue)
	const preview = isControlled ? value : internalPreview

	return (
		<div className="markdown-editor">
			<div className="markdown-editor__pane">
				<Textarea
					label={label}
					name={name}
					{...(isControlled ? { value } : { defaultValue })}
					size={size}
					minRows={minRows}
					onChange={(e) => {
						if (isControlled) {
							onChange?.(e.target.value)
						} else {
							setInternalPreview(e.target.value)
						}
					}}
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
