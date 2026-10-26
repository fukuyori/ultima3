/** Runtime language files are discovered through public/locales/index.json. */
export type Language = string;

type Messages = Record<string, string>;
const catalogs: Partial<Record<Language, Messages>> = {};
const patterns: Partial<Record<Language, [string, string][]>> = {};
/** Whole texts only (a catalog's `phrases`): never substituted inside other text. */
const phrases: Partial<Record<Language, Messages>> = {};
/** Phrases with {0}, {1}...: matched whole, the parts filled in localized. Longest literal text first. */
const templates: Partial<Record<Language, [RegExp, string][]>> = {};
/** Multi-line entries by their words on one line, as the journal quotes speech; the translation's lines joined. */
const spoken: Partial<Record<Language, Messages>> = {};
const names: Partial<Record<Language, string>> = { en: 'English', ja: 'Japanese' };
let languages: Language[] = ['en', 'ja'];
let language: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && languages.includes(value);
}

export async function loadLanguages(): Promise<void> {
  try {
    const response = await fetch('locales/index.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'languages' in data && Array.isArray(data.languages)) {
      languages = data.languages.filter((entry): entry is string => typeof entry === 'string' && /^[a-zA-Z0-9-]+$/.test(entry));
    }
  } catch {
    console.warn('[i18n] Could not load locales/index.json; using the built-in English and Japanese entries.');
  }
  if (!languages.includes('en')) languages.unshift('en');
  if (!languages.includes('ja')) languages.push('ja');
  await Promise.all(
    languages.map(async (code) => {
      try {
        const response = await fetch(`locales/${code}.json`);
        if (!response.ok) {
          console.warn(`[i18n] Could not load locales/${code}.json: HTTP ${response.status}`);
          return;
        }
        const data: unknown = await response.json();
        if (data && typeof data === 'object' && 'messages' in data && typeof data.messages === 'object') {
          catalogs[code] = data.messages as Messages;
          patterns[code] = Object.entries(catalogs[code])
            .filter(([source, target]) => source && source !== target && /^[\x20-\x7e]+$/.test(source))
            .sort(([a], [b]) => b.length - a.length);
          if ('name' in data && typeof data.name === 'string') names[code] = data.name;
          phrases[code] = 'phrases' in data && data.phrases && typeof data.phrases === 'object' ? (data.phrases as Messages) : {};
          templates[code] = Object.entries(phrases[code])
            .filter(([source]) => /\{\d\}/.test(source))
            .sort(([a], [b]) => b.replace(/\{\d\}/g, '').length - a.replace(/\{\d\}/g, '').length)
            .map(([source, target]) => {
              const literal = source.split(/\{\d\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
              return [new RegExp(`^${literal.join('(.+?)')}$`), target];
            });
          spoken[code] = Object.fromEntries(
            [...Object.entries(catalogs[code]), ...Object.entries(phrases[code])]
              .filter(([source]) => source.includes('\n'))
              .map(([source, target]) => [oneLine(source), joinLines(target.split('\n'))]),
          );
        }
      } catch {
        console.warn(`[i18n] Could not load locales/${code}.json.`);
      }
    }),
  );
}

export function setLanguage(code: Language): void {
  language = code;
}

export function getLanguage(): Language {
  return language;
}

export function availableLanguages(): { code: Language; name: string }[] {
  return languages.map((code) => ({ code, name: names[code] ?? code }));
}

export function translate(text: string): string {
  if (text.length < 2) return text;
  const messages = catalogs[language];
  if (!messages) return text;
  const exact = messages[text] ?? phrases[language]?.[text];
  if (exact !== undefined) return exact;
  const replace = (part: string): string => {
    if (messages[part] !== undefined) return messages[part];
    return (patterns[language] ?? []).reduce((result, [source, target]) => {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return result.replace(new RegExp(`\\b${escaped}\\b`, 'g'), target);
    }, part);
  };
  return text
    .split(/(\r?\n)/)
    .map((part) => (/^\r?\n$/.test(part) ? part : replace(part)))
    .join('');
}

/**
 * Text the game builds whole and wraps itself (the journal's lines, cards and hints), translated before it is
 * wrapped: as a whole phrase or entry, as a quoted speech, by a template, or else sentence by sentence. What
 * nothing matches stays as it is.
 */
export function localize(text: string): string {
  if (!catalogs[language]) return text;
  return phrase(text) ?? text;
}

function phrase(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const found = phrases[language]?.[t] ?? catalogs[language]?.[t] ?? spoken[language]?.[oneLine(t)];
  if (found !== undefined) return found;
  const sentences = t.split(/(?<=[.!?])\s+(?=\S)/);
  if (sentences.length > 1) {
    const done = sentences.map(phrase);
    return done.some((s) => s !== undefined) ? joinLines(done.map((s, i) => s ?? sentences[i])) : undefined;
  }
  for (const [pattern, target] of templates[language] ?? []) {
    const match = pattern.exec(t);
    if (!match) continue;
    const parts = match.slice(1).map((part) => phrase(part) ?? list(part) ?? part);
    return target.replace(/\{(\d)\}/g, (_, n: string) => parts[Number(n)] ?? '');
  }
  return undefined;
}

/** A list ("Love, Sol and Moons") whose every item is known, in the language's own list. */
function list(text: string): string | undefined {
  const items = text.split(/, (?:and )?| and /);
  if (items.length < 2) return undefined;
  const done = items.map(phrase);
  return done.every((item) => item !== undefined) ? done.join('、') : undefined;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Lines or sentences run together: a space only between two of plain ASCII. */
function joinLines(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((out, line) => (out && /[\x21-\x7e]$/.test(out) && /^[\x21-\x7e]/.test(line) ? `${out} ${line}` : out + line), '');
}
