// Playback streams from Mojang's official asset store. It has no CORS headers,
// so scripts can't read the bytes — but <audio> elements can play it just fine.
export function playbackUrl(hash: string): string {
  return `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
}

// Byte downloads (single files and ZIP) need CORS, which Mojang's store lacks.
// These community mirrors serve the exact same files (we verify SHA-1 against
// Mojang's own asset index) with `Access-Control-Allow-Origin: *`.
const MIRRORS: ((version: string, path: string) => string)[] = [
  (version, path) =>
    `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${version}/assets/${path}`,
  (version, path) => `https://assets.mcasset.cloud/${version}/assets/${path}`,
];

export function byteUrlCandidates(versionId: string, assetPath: string): string[] {
  const version = encodeURIComponent(versionId);
  // Legacy indexes may omit the "minecraft/" prefix; try both layouts.
  const paths = assetPath.startsWith('minecraft/')
    ? [assetPath]
    : [`minecraft/${assetPath}`, assetPath];
  return MIRRORS.flatMap((mirror) => paths.map((p) => mirror(version, p)));
}
