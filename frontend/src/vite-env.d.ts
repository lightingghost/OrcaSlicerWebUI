/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Frontend app version, injected at build time from package.json's own
 *  `version` field — see vite.config.ts's `define` block. */
declare const __APP_VERSION__: string;
