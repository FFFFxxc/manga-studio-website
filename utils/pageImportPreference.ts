export type ImageImportDestination = 'page' | 'layer';

export const IMAGE_IMPORT_PREFERENCE_KEY = 'manga-studio-image-import-destination';
export const IMAGE_IMPORT_PREFERENCE_EVENT = 'manga-studio-image-import-preference-change';

export function loadImageImportPreference(): ImageImportDestination | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(IMAGE_IMPORT_PREFERENCE_KEY);
    return value === 'page' || value === 'layer' ? value : null;
  } catch {
    return null;
  }
}

export function storeImageImportPreference(destination: ImageImportDestination | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (destination) window.localStorage.setItem(IMAGE_IMPORT_PREFERENCE_KEY, destination);
    else window.localStorage.removeItem(IMAGE_IMPORT_PREFERENCE_KEY);
    window.dispatchEvent(new Event(IMAGE_IMPORT_PREFERENCE_EVENT));
  } catch {
    // Private browsing or restrictive storage policies must not break import.
  }
}

export function resolveImageImportDestination({
  hasDocument,
  forcePage = false,
  remembered,
}: {
  hasDocument: boolean;
  forcePage?: boolean;
  remembered: ImageImportDestination | null;
}): ImageImportDestination {
  if (!hasDocument || forcePage) return 'page';
  return remembered ?? 'layer';
}
