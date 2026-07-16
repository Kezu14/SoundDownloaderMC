// One shared <audio> element: starting a sound stops the previous one.
const audio = new Audio();
audio.preload = 'none';

let currentKey: string | null = null;
let listener: (playingKey: string | null) => void = () => {};

export function onPlayerChange(cb: (playingKey: string | null) => void): void {
  listener = cb;
}

export function togglePlay(key: string, url: string): void {
  if (currentKey === key) {
    if (audio.paused) {
      void audio.play().catch(() => listener(null));
    } else {
      audio.pause();
    }
    return;
  }
  currentKey = key;
  audio.src = url;
  void audio.play().catch(() => listener(null));
}

export function stopPlayback(): void {
  currentKey = null;
  audio.pause();
  audio.removeAttribute('src');
}

audio.addEventListener('play', () => listener(currentKey));
audio.addEventListener('pause', () => listener(null));
audio.addEventListener('ended', () => listener(null));
audio.addEventListener('error', () => listener(null));
