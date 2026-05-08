export interface PanelConfig {
  proxy: { target: string; path: string } | null;
  panelPath: string;
}

export async function fetchConfig(): Promise<PanelConfig | null> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return null;
    return (await res.json()) as PanelConfig;
  } catch {
    return null;
  }
}
