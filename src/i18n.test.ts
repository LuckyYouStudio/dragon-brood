import { describe, expect, it } from 'vitest';
import { ALL_STRINGS, LANGUAGES, type Key } from './i18n';

const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');

describe('translations', () => {
  it('cover every key with the same placeholders as English', () => {
    const english = ALL_STRINGS.en;
    for (const { code } of LANGUAGES) {
      const dict = ALL_STRINGS[code];
      for (const key of Object.keys(english) as Key[]) {
        expect(dict[key], `${code}.${key}`).toBeTruthy();
        expect(slots(dict[key]), `${code}.${key}`).toBe(slots(english[key]));
      }
    }
  });
});
