// Módulos opcionales (chrome.storage.sync): limpieza de enlaces y rechazo de cookies.
// Valen para todos los sitios; la lista blanca los apaga en un sitio concreto.

export const MODULES_KEY = 'modules';

/** Ruleset DNR con los `$removeparam` de filters/largo-links.txt (id de la lista en update-lists). */
export const LINKS_RULESET = 'links';

export interface Modules {
  /** Quita parámetros de rastreo de las URL. */
  links: boolean;
  /** Pulsa "rechazar" en los avisos de cookies. */
  cookies: boolean;
}

export type ModuleName = keyof Modules;

export const DEFAULT_MODULES: Modules = { links: true, cookies: true };

export function isModuleName(v: unknown): v is ModuleName {
  return typeof v === 'string' && Object.hasOwn(DEFAULT_MODULES, v);
}

export async function getModules(): Promise<Modules> {
  const stored = (await chrome.storage.sync.get(MODULES_KEY))[MODULES_KEY] as Partial<Record<ModuleName, unknown>> | undefined;
  const out = { ...DEFAULT_MODULES };
  for (const k of Object.keys(out) as ModuleName[]) if (typeof stored?.[k] === 'boolean') out[k] = stored[k];
  return out;
}

export async function setModule(name: ModuleName, enabled: boolean): Promise<void> {
  await chrome.storage.sync.set({ [MODULES_KEY]: { ...(await getModules()), [name]: enabled } });
}
