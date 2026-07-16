import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works on GitHub Pages under any repo name.
  base: './',
  // Bind IPv4 loopback explicitly: on some Windows setups "localhost" resolves
  // to ::1 only, which breaks tools that connect via 127.0.0.1.
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
