/**
 * Type overrides for archiver v8 (ESM, named class exports).
 * The DefinitelyTyped package @types/archiver covers the v6/v7 function API
 * and does not include ZipArchive / TarArchive from v8.
 */
declare module "archiver" {
	import { Transform, TransformOptions } from "node:stream"

	interface ZipOptions extends TransformOptions {
		zlib?: {
			level?: number
		}
	}

	interface EntryData {
		name: string
		date?: Date | string
		mode?: number
		prefix?: string
	}

	class Archiver extends Transform {
		append(source: Buffer | NodeJS.ReadableStream, data: EntryData): this
		finalize(): Promise<void>
		abort(): this
		on(event: "warning", listener: (err: Error) => void): this
		on(event: "error", listener: (err: Error) => void): this
		on(event: string, listener: (...args: unknown[]) => void): this
		pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean }): T
	}

	class ZipArchive extends Archiver {
		constructor(options?: ZipOptions)
	}

	class TarArchive extends Archiver {
		constructor(options?: TransformOptions)
	}

	class JsonArchive extends Archiver {
		constructor(options?: TransformOptions)
	}

	export { Archiver, ZipArchive, TarArchive, JsonArchive }
}
