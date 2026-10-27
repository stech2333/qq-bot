export function normalizeMemoryControl(value = {}) {
  return { accumulation: value?.accumulation !== false, personalization: value?.personalization !== false };
}
