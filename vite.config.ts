import { defineConfig } from 'vite';

export default defineConfig({
  // IIS 하위 폴더 등 어느 경로에 올려도 동작하도록 상대 경로로 빌드한다.
  base: './',
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000, // Phaser는 단독 청크로 분리 (약 1.x MB)
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
});
