/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_APP_VIEW?: string
  readonly VITE_ACCESS_USER?: string
  readonly VITE_ACCESS_PASSWORD?: string
  readonly VITE_BASE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
