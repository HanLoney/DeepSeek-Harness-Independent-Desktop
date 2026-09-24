/**
 * Read and write DSH session-log artifacts without a live `Session`.
 *
 * A DSH artifact is a concatenation of independently decodable, checksummed
 * Zstandard frames. The first frame holds exactly one record — the session
 * header line — and every later frame holds a batch of event lines. Because
 * frames decode independently, a reader can validate a prefix without
 * decompressing the tail, which is what the truncation-repair path relies on.
 *
 * This module reproduces that container so an imported transcript lands as a
 * log the ordinary backend reads. It is intentionally a reimplementation of
 * the framing rather than a call into `dsh-session-persistence-jsonl`: the
 * backend owns its frames as an implementation detail and exports no framing
 * entry point, and the bridge only needs the format's public invariants
 * (frame-per-batch, checksummed, header frame first).
 *
 * @module @deepseek-ai/dsh-codex-bridge/dsh-store
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { FoldedEvent } from './types.ts'

/** Little-endian byte order of the Zstandard frame magic. */
const ZSTD_MAGIC = 0xFD2FB528

/** Compress one independently decodable, checksummed frame. */
function compressFrame(input: string): Buffer {
  return zstdCompressSync(Buffer.from(input, 'utf8'), {
    params: { [constants.ZSTD_c_checksumFlag]: 1 },
  })
}

/** Byte range occupied by one structurally complete frame. */
interface FrameRange { start: number; end: number }

/**
 * Locate complete frames in a concatenated Zstandard stream.
 *
 * @param buffer - the complete bytes currently present in the artifact.
 * @returns complete frame ranges, and the start of a trailing incomplete frame when present.
 */
export function scanFrames(buffer: Buffer): { frames: FrameRange[]; tornStart?: number } {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt session artifact: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`corrupt session artifact: reserved frame-header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`corrupt session artifact: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    // A frame written with the checksum flag carries a trailing 4-byte digest.
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/**
 * Encode one string as a single safe filesystem path segment.
 *
 * @param raw - the string to encode; must be non-empty.
 * @returns the escaped segment, decodable back to `raw`.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Build the human-navigable project directory key for one working directory.
 *
 * @param cwd - the session's project directory; must be non-empty.
 * @returns the project directory name, bounded for filesystem component limits.
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * Resolve the artifact path an ordinary backend would use for one session.
 *
 * @param root - the session root directory.
 * @param cwd - the session's project directory, or `undefined` for `_no-cwd`.
 * @param id - the session id.
 * @returns the absolute path of the session's compressed JSONL artifact.
 */
export function artifactPath(root: string, cwd: string | undefined, id: string): string {
  const project = cwd === undefined ? '_no-cwd' : projectKey(cwd)
  return join(root, project, encodeSegment(id), 'session.jsonl.zstd')
}

/** The header record this bridge writes as the first line of every artifact. */
export interface WrittenHeader {
  /** Session id. */
  id: string
  /** Unix epoch milliseconds. */
  createdAt: number
  /** Working directory, omitted when unknown. */
  cwd?: string
  /** Agent preset name, omitted for an imported transcript. */
  agentPreset?: string
}

/**
 * Serialize a session log as a concatenated-frame artifact.
 *
 * @param header - the session header to write as the first frame.
 * @param events - the events to write, in log order.
 * @param eventsPerFrame - batch size controlling the frame count.
 * @returns the complete artifact bytes.
 */
export function packArtifact(header: WrittenHeader, events: readonly FoldedEvent[], eventsPerFrame = 512): Buffer {
  const headerLine = JSON.stringify({
    type: 'session',
    version: SESSION_FORMAT_VERSION,
    id: header.id,
    createdAt: header.createdAt,
    ...header.cwd !== undefined ? { cwd: header.cwd } : {},
    delegationDepth: 0,
    ...header.agentPreset !== undefined ? { agentPreset: header.agentPreset } : {},
  })
  // The backend asserts the first frame holds exactly one record; a trailing
  // newline there is part of that record.
  const frames: Buffer[] = [compressFrame(headerLine + '\n')]
  for (let i = 0; i < events.length; i += eventsPerFrame) {
    const batch = events.slice(i, i + eventsPerFrame)
    frames.push(compressFrame(batch.map(event => JSON.stringify(event)).join('\n') + '\n'))
  }
  return Buffer.concat(frames)
}

/**
 * Decode every record of a session artifact.
 *
 * @param buffer - the complete artifact bytes.
 * @returns the header record and every event record, in log order.
 */
export function unpackArtifact(buffer: Buffer): { header: Record<string, unknown>; events: FoldedEvent[] } {
  const { frames } = scanFrames(buffer)
  const [firstFrame] = frames
  if (firstFrame === undefined) throw new Error('empty or header-less session artifact')
  const headerFrame = zstdDecompressSync(buffer.subarray(firstFrame.start, firstFrame.end)).toString('utf8')
  const headerLines = headerFrame.split('\n').filter(line => line.length > 0)
  const [headerLine] = headerLines
  if (headerLine === undefined || headerLines.length !== 1) {
    throw new Error('corrupt session artifact: first frame is not exactly one header line')
  }
  const header = JSON.parse(headerLine) as Record<string, unknown>
  if (header['type'] !== 'session') throw new Error('corrupt session artifact: first record is not a session header')
  const events: FoldedEvent[] = []
  for (const frame of frames.slice(1)) {
    const text = zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      events.push(JSON.parse(line) as FoldedEvent)
    }
  }
  return { header, events }
}

/**
 * Read one session artifact from disk.
 *
 * @param path - absolute artifact path.
 * @returns the header record and every event record.
 */
export async function readArtifact(path: string): Promise<{ header: Record<string, unknown>; events: FoldedEvent[] }> {
  return unpackArtifact(await readFile(path))
}

/**
 * Write one session artifact, creating its project and session directories.
 *
 * @param path - absolute artifact path.
 * @param bytes - the complete artifact bytes.
 */
export async function writeArtifact(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}
