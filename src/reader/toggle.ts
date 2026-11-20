/** Abre o cierra el modo lectura en una pestaña (marco principal). Falla en silencio en las
 *  páginas donde Chrome no deja inyectar scripts (chrome://, Chrome Web Store, PDF…). */
export async function toggleReader(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['reader/reader.js'] });
    return true;
  } catch {
    return false;
  }
}
