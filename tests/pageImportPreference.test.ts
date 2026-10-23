import { beforeEach, describe, expect, it } from 'vitest';
import {
  IMAGE_IMPORT_PREFERENCE_KEY,
  IMAGE_IMPORT_PREFERENCE_EVENT,
  loadImageImportPreference,
  resolveImageImportDestination,
  storeImageImportPreference,
} from '@/utils/pageImportPreference';

describe('image import destination', () => {
  beforeEach(() => window.localStorage.clear());

  it('always creates pages when there is no document or page import is forced', () => {
    expect(resolveImageImportDestination({ hasDocument: false, remembered: 'layer' })).toBe('page');
    expect(resolveImageImportDestination({ hasDocument: true, forcePage: true, remembered: 'layer' })).toBe('page');
  });

  it('defaults to a layer on the open page without a blocking choice dialog', () => {
    expect(resolveImageImportDestination({ hasDocument: true, remembered: null })).toBe('layer');
  });

  it('loads, stores and resets a valid preference', () => {
    let changes = 0;
    const onChange = () => { changes += 1; };
    window.addEventListener(IMAGE_IMPORT_PREFERENCE_EVENT, onChange);
    storeImageImportPreference('layer');
    expect(window.localStorage.getItem(IMAGE_IMPORT_PREFERENCE_KEY)).toBe('layer');
    expect(loadImageImportPreference()).toBe('layer');
    storeImageImportPreference(null);
    expect(loadImageImportPreference()).toBeNull();
    expect(changes).toBe(2);
    window.removeEventListener(IMAGE_IMPORT_PREFERENCE_EVENT, onChange);
  });

  it('ignores corrupt preference values', () => {
    window.localStorage.setItem(IMAGE_IMPORT_PREFERENCE_KEY, 'banana');
    expect(loadImageImportPreference()).toBeNull();
  });
});
