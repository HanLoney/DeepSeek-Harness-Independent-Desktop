/**
 * Public entry for the optional image-generation tool package. The host
 * runtime ships as checked-in upstream JavaScript; this module re-exports its
 * loader contract so consumers resolve one typed entry.
 * @module @deepseek-ai/dsh-tool-image-gen
 */
export * from './runtime.js'
