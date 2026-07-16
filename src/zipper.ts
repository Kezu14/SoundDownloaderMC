import { downloadZip } from 'client-zip';
import type { SoundEntry } from './mojang';
import { byteUrlCandidates } from './sources';

export interface ZipProgress {
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  failures: { path: string; reason: string }[];
}

const CONCURRENCY = 6;
const ATTEMPT_ROUNDS = 3; // 1 attempt + 2 retries over the mirror list

/** Fetch one sound, trying each mirror URL, verifying SHA-1 against Mojang's index. */
export async function fetchSoundBlob(
  versionId: string,
  entry: SoundEntry,
  signal?: AbortSignal,
): Promise<Blob> {
  const urls = byteUrlCandidates(versionId, entry.path);
  let lastError = 'no mirror succeeded';
  for (let round = 0; round < ATTEMPT_ROUNDS; round++) {
    if (round > 0) await delay(400 * round, signal);
    for (const url of urls) {
      signal?.throwIfAborted();
      try {
        const res = await fetch(url, { signal });
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          continue;
        }
        const buf = await res.arrayBuffer();
        const digest = await sha1Hex(buf);
        if (digest !== null && digest !== entry.hash) {
          lastError = 'SHA-1 mismatch';
          continue;
        }
        return new Blob([buf], { type: 'audio/ogg' });
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }
  throw new Error(lastError);
}

/**
 * Download every entry (concurrency-limited), stream them into one ZIP and save it.
 * Uses the File System Access API when available (streams straight to disk),
 * otherwise falls back to assembling a Blob in memory.
 */
export async function downloadAllAsZip(
  versionId: string,
  entries: readonly SoundEntry[],
  onProgress: (progress: ZipProgress) => void,
  signal: AbortSignal,
): Promise<ZipProgress> {
  const progress: ZipProgress = {
    filesDone: 0,
    filesTotal: entries.length,
    bytesDone: 0,
    bytesTotal: entries.reduce((sum, e) => sum + e.size, 0),
    failures: [],
  };
  const safeVersion = versionId.replace(/[^\w.-]+/g, '_');
  const baseName = `minecraft-${safeVersion}-sounds`;

  // Ask where to save before doing any work (keeps the user gesture fresh).
  let writable: FileSystemWritableFileStream | null = null;
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: `${baseName}.zip`,
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    });
    writable = await handle.createWritable();
  }

  type Fetched = { entry: SoundEntry; blob?: Blob; error?: string };

  // Same relative path with different content can still appear twice (rare,
  // legacy indexes) — suffix duplicates so ZIP entry names stay unique.
  const usedNames = new Set<string>();
  const uniqueName = (name: string): string => {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot === -1 ? name : name.slice(0, dot);
    const ext = dot === -1 ? '' : name.slice(dot);
    for (let i = 2; ; i++) {
      const candidate = `${stem} (${i})${ext}`;
      if (!usedNames.has(candidate)) {
        usedNames.add(candidate);
        return candidate;
      }
    }
  };

  async function* files(): AsyncGenerator<{ name: string; input: Blob }> {
    const inFlight: Promise<Fetched>[] = [];
    let next = 0;
    const startNext = () => {
      const entry = entries[next++]!;
      inFlight.push(
        fetchSoundBlob(versionId, entry, signal).then(
          (blob) => ({ entry, blob }),
          (err: unknown) => ({
            entry,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
    };
    while (next < entries.length && inFlight.length < CONCURRENCY) startNext();
    while (inFlight.length > 0) {
      const done = await inFlight.shift()!;
      signal.throwIfAborted();
      if (next < entries.length) startNext();
      progress.filesDone++;
      progress.bytesDone += done.entry.size;
      if (done.blob) {
        yield { name: uniqueName(`${baseName}/${done.entry.display}`), input: done.blob };
      } else {
        progress.failures.push({ path: done.entry.display, reason: done.error ?? 'unknown error' });
      }
      onProgress(progress);
    }
  }

  const zip = downloadZip(files());
  if (writable) {
    // pipeTo closes the destination on success and aborts it (discarding the
    // partial file) on cancellation/error.
    await zip.body!.pipeTo(writable, { signal });
  } else {
    const blob = await zip.blob();
    signal.throwIfAborted();
    triggerBlobDownload(blob, `${baseName}.zip`);
  }
  return progress;
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function sha1Hex(buf: ArrayBuffer): Promise<string | null> {
  if (!crypto.subtle) return null; // non-secure context — skip verification
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(
          signal.reason instanceof Error || signal.reason instanceof DOMException
            ? signal.reason
            : new DOMException('Aborted', 'AbortError'),
        );
      },
      { once: true },
    );
  });
}
