import './style.css';
import { fetchManifest, fetchSounds } from './mojang';
import type { SoundEntry, VersionInfo, VersionManifest } from './mojang';
import { playbackUrl } from './sources';
import { onPlayerChange, stopPlayback, togglePlay } from './player';
import { downloadAllAsZip, fetchSoundBlob, triggerBlobDownload } from './zipper';
import type { ZipProgress } from './zipper';
import { debounce, fmtCount, fmtSize, must } from './ui';

const versionType = must<HTMLSelectElement>('version-type');
const versionSearch = must<HTMLInputElement>('version-search');
const versionSelect = must<HTMLSelectElement>('version-select');
const soundSearch = must<HTMLInputElement>('sound-search');
const categorySelect = must<HTMLSelectElement>('category-select');
const statsEl = must<HTMLSpanElement>('stats');
const downloadAllBtn = must<HTMLButtonElement>('download-all');
const progressPanel = must<HTMLElement>('progress-panel');
const progressBar = must<HTMLDivElement>('progress-bar');
const progressText = must<HTMLSpanElement>('progress-text');
const progressCancel = must<HTMLButtonElement>('progress-cancel');
const progressReport = must<HTMLDetailsElement>('progress-report');
const soundList = must<HTMLElement>('sound-list');
const errorBanner = must<HTMLDivElement>('error-banner');

let manifest: VersionManifest | null = null;
let currentVersion: VersionInfo | null = null;
let allSounds: SoundEntry[] = [];
let filtered: SoundEntry[] = [];
let loadSeq = 0;
let zipping = false;
let zipAbort: AbortController | null = null;
let playingPath: string | null = null;

function showError(message: string | null): void {
  errorBanner.hidden = message === null;
  errorBanner.textContent = message ?? '';
}

function visibleVersions(): VersionInfo[] {
  if (!manifest) return [];
  const type = versionType.value;
  const query = versionSearch.value.trim().toLowerCase();
  return manifest.versions.filter((v) => {
    const typeOk =
      type === 'all' ||
      (type === 'release' && v.type === 'release') ||
      (type === 'snapshot' && v.type === 'snapshot') ||
      (type === 'old' && (v.type === 'old_beta' || v.type === 'old_alpha'));
    return typeOk && (!query || v.id.toLowerCase().includes(query));
  });
}

function renderVersionOptions(): void {
  const versions = visibleVersions();
  versionSelect.replaceChildren(
    ...versions.map((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.id} — ${v.releaseTime.slice(0, 10)}`;
      return opt;
    }),
  );
  if (currentVersion && versions.some((v) => v.id === currentVersion!.id)) {
    versionSelect.value = currentVersion.id;
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = versions.length
      ? `— select a version (${fmtCount(versions.length)}) —`
      : 'no matching versions';
    versionSelect.prepend(placeholder);
  }
}

async function loadVersion(id: string): Promise<void> {
  const version = manifest?.versions.find((v) => v.id === id);
  if (!version) return;
  const seq = ++loadSeq;
  currentVersion = version;
  stopPlayback();
  showError(null);
  statsEl.textContent = `Loading sounds for ${version.id}…`;
  downloadAllBtn.disabled = true;
  downloadAllBtn.textContent = 'Download all';
  soundList.replaceChildren();
  categorySelect.replaceChildren();
  try {
    const sounds = await fetchSounds(version);
    if (seq !== loadSeq) return;
    allSounds = sounds;
    renderCategories();
    applyFilter();
  } catch (err) {
    if (seq !== loadSeq) return;
    allSounds = [];
    filtered = [];
    statsEl.textContent = '';
    showError(`Failed to load ${version.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function renderCategories(): void {
  const counts = new Map<string, number>();
  for (const s of allSounds) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = `All categories (${fmtCount(allSounds.length)})`;
  categorySelect.replaceChildren(
    all,
    ...[...counts.keys()].sort().map((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = `${cat} (${fmtCount(counts.get(cat)!)})`;
      return opt;
    }),
  );
}

function applyFilter(): void {
  const query = soundSearch.value.trim().toLowerCase();
  const cat = categorySelect.value || 'all';
  filtered = allSounds.filter(
    (s) => (cat === 'all' || s.category === cat) && (!query || s.display.toLowerCase().includes(query)),
  );
  renderList();
  const bytes = filtered.reduce((sum, s) => sum + s.size, 0);
  statsEl.textContent = `${fmtCount(filtered.length)} / ${fmtCount(allSounds.length)} files · ${fmtSize(bytes)}`;
  downloadAllBtn.disabled = zipping || filtered.length === 0;
  downloadAllBtn.textContent =
    filtered.length === allSounds.length
      ? `Download all (${fmtSize(bytes)})`
      : `Download filtered (${fmtSize(bytes)})`;
}

function renderList(): void {
  const frag = document.createDocumentFragment();
  filtered.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.idx = String(i);
    row.dataset.path = s.path;

    const play = document.createElement('button');
    play.className = 'icon play';
    play.dataset.action = 'play';
    play.title = 'Play / pause';
    play.setAttribute('aria-label', `Play ${s.display}`);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = s.display;
    name.title = s.path;

    const cat = document.createElement('span');
    cat.className = 'cat';
    cat.textContent = s.category;

    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = fmtSize(s.size);

    const dl = document.createElement('button');
    dl.className = 'icon dl';
    dl.dataset.action = 'download';
    dl.title = 'Download file';
    dl.setAttribute('aria-label', `Download ${s.display}`);

    row.append(play, name, cat, size, dl);
    frag.append(row);
  });
  soundList.replaceChildren(frag);
  syncPlayingRow(playingPath);
}

function syncPlayingRow(path: string | null): void {
  playingPath = path;
  soundList.querySelector('.row.playing')?.classList.remove('playing');
  if (path) {
    soundList.querySelector(`.row[data-path="${CSS.escape(path)}"]`)?.classList.add('playing');
  }
}

async function singleDownload(entry: SoundEntry, btn: HTMLButtonElement): Promise<void> {
  if (!currentVersion) return;
  btn.disabled = true;
  btn.classList.add('busy');
  try {
    const blob = await fetchSoundBlob(currentVersion.id, entry);
    triggerBlobDownload(blob, entry.display.split('/').pop() ?? 'sound.ogg');
  } catch (err) {
    showError(`Download failed for ${entry.display}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}

function setZipUiActive(active: boolean): void {
  for (const el of [versionType, versionSearch, versionSelect, downloadAllBtn]) {
    el.disabled = active;
  }
  if (active) {
    progressPanel.hidden = false;
    progressReport.hidden = true;
    progressCancel.hidden = false;
  } else {
    progressCancel.hidden = true;
    applyFilter(); // restore the Download button state/label
  }
}

function updateZipProgress(p: ZipProgress): void {
  const pct = p.bytesTotal > 0 ? (p.bytesDone / p.bytesTotal) * 100 : 0;
  progressBar.style.width = `${pct.toFixed(2)}%`;
  progressText.textContent =
    `${fmtCount(p.filesDone)} / ${fmtCount(p.filesTotal)} files · ` +
    `${fmtSize(p.bytesDone)} / ${fmtSize(p.bytesTotal)}` +
    (p.failures.length ? ` · ${fmtCount(p.failures.length)} failed` : '');
}

function showZipReport(result: ZipProgress): void {
  if (result.failures.length === 0) {
    progressText.textContent = `Done — ${fmtCount(result.filesTotal)} files, ${fmtSize(result.bytesTotal)}. ZIP saved.`;
    return;
  }
  const okCount = result.filesTotal - result.failures.length;
  progressText.textContent = `Done — ${fmtCount(okCount)} files saved, ${fmtCount(result.failures.length)} failed.`;
  const summary = progressReport.querySelector('summary')!;
  const pre = progressReport.querySelector('pre')!;
  summary.textContent = `Show ${fmtCount(result.failures.length)} failed files`;
  pre.textContent = result.failures.map((f) => `${f.path} — ${f.reason}`).join('\n');
  progressReport.hidden = false;
}

async function startZip(): Promise<void> {
  if (zipping || !currentVersion || filtered.length === 0) return;
  const bytes = filtered.reduce((sum, s) => sum + s.size, 0);
  const proceed = confirm(
    `Download ${fmtCount(filtered.length)} files (${fmtSize(bytes)}) from version ${currentVersion.id} as one ZIP archive?`,
  );
  if (!proceed) return;

  zipping = true;
  zipAbort = new AbortController();
  const entries = [...filtered]; // snapshot: later filter changes don't affect the run
  const versionId = currentVersion.id;
  setZipUiActive(true);
  updateZipProgress({ filesDone: 0, filesTotal: entries.length, bytesDone: 0, bytesTotal: bytes, failures: [] });
  progressText.textContent = 'Starting…';

  try {
    const result = await downloadAllAsZip(versionId, entries, updateZipProgress, zipAbort.signal);
    showZipReport(result);
  } catch (err) {
    const aborted = zipAbort.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
    progressText.textContent = aborted
      ? 'Cancelled.'
      : `Failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    zipping = false;
    zipAbort = null;
    setZipUiActive(false);
  }
}

async function init(): Promise<void> {
  onPlayerChange(syncPlayingRow);
  versionType.addEventListener('change', renderVersionOptions);
  versionSearch.addEventListener('input', debounce(renderVersionOptions, 150));
  versionSelect.addEventListener('change', () => {
    if (versionSelect.value) void loadVersion(versionSelect.value);
  });
  soundSearch.addEventListener('input', debounce(applyFilter, 150));
  categorySelect.addEventListener('change', applyFilter);
  downloadAllBtn.addEventListener('click', () => void startZip());
  progressCancel.addEventListener('click', () => zipAbort?.abort());
  soundList.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn) return;
    const row = btn.closest<HTMLElement>('.row');
    const entry = filtered[Number(row?.dataset.idx ?? -1)];
    if (!entry) return;
    if (btn.dataset.action === 'play') {
      togglePlay(entry.path, playbackUrl(entry.hash));
    } else {
      void singleDownload(entry, btn);
    }
  });

  try {
    manifest = await fetchManifest();
  } catch (err) {
    statsEl.textContent = '';
    showError(`Failed to load Mojang version manifest: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  renderVersionOptions();
  const latest = manifest.latest.release;
  if (manifest.versions.some((v) => v.id === latest)) {
    versionSelect.value = latest;
    void loadVersion(latest);
  }
}

void init();
