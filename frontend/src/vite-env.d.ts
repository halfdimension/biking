/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional MapLibre STYLE URL used for the basemap (Req 20.4).
   *
   * When set, the app uses this URL directly as the MapLibre style. When
   * absent, the app builds an inline OSM raster style at runtime (Task 13).
   * This is a MapLibre *style* URL, not a raster tile URL.
   */
  readonly VITE_MAP_STYLE_URL?: string;

  /**
   * Optional override for the backend API base URL.
   *
   * When absent, the API client defaults to "http://localhost:8000".
   */
  readonly VITE_API_BASE_URL?: string;

  /**
   * Dev-only diagnostic opt-in. When set to "1", exposes `window.__map` and
   * `window.__store` even in a production/preview build so a headless browser
   * can verify the live MapLibre render. Off by default; never affects
   * rendering behavior.
   */
  readonly VITE_EXPOSE_MAP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
