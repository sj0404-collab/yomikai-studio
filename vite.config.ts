import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Плагин стенда: обычный JSON-плагин читалки (тот же формат, что у приложения).
 * Лежит в koma/plugins/forge-emulator.json — правки поведения читалки делаются
 * файлом, без пересборки АПК. Здесь файл читается на старте dev-сервера и
 * отдаётся странице через define.
 */
function komaPlugin(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(resolve(__dirname, 'koma/plugins/forge-emulator.json'), 'utf8'));
  } catch {
    return {};
  }
}

export default defineConfig(({ mode }): UserConfig => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_']);
  const processEnvDefines: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify(value);
  }

  return {
    base: './',
    plugins: [react(), tailwindcss()],
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: {
      ...processEnvDefines,
      __KOMA_PLUGIN__: JSON.stringify(komaPlugin()),
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
    },
    preview: {
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
