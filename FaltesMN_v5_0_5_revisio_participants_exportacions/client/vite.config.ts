import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(() => {
  const apiTarget = process.env.VITE_API_BASE || 'http://localhost:8787'
  const configDir = path.dirname(fileURLToPath(new URL(import.meta.url)))
  const certDir = path.resolve(configDir, 'certs')
  const certFile = path.join(certDir, 'dev-cert.pem')
  const keyFile = path.join(certDir, 'dev-key.pem')
  const hasHttpsCert = fs.existsSync(certFile) && fs.existsSync(keyFile)
  const isolationHeaders = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp'
  }

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: false,
        },
        workbox: {
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 7 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.endsWith('.tar.gz') && url.pathname.includes('/vosk/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'vosk-models',
                expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
              }
            },
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 10 },
              }
            }
          ]
        },
        manifest: {
          name: 'FaltesMN (CAT)',
          short_name: 'FaltesMN',
          description: "Aplicació d'àrbitres de Marxa Nòrdica (Català).",
          start_url: '.',
          display: 'standalone',
          background_color: '#e8f5e9',
          theme_color: '#1f5fa8',
          icons: [
            { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' }
          ]
        },
      })
    ],
    server: {
      headers: isolationHeaders,
      strictPort: true,
      port: 5173,
      https: hasHttpsCert
        ? {
            cert: fs.readFileSync(certFile),
            key: fs.readFileSync(keyFile),
          }
        : undefined,
      proxy: {
        '/api': apiTarget,
        '/ws': {
          target: apiTarget,
          ws: true
        }
      }
    },
    preview: {
      headers: isolationHeaders
    }
  }
})
