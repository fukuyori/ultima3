/** Runtime language files are discovered through public/locales/index.json. */
export type Language = string;

type Messages = Record<string, string>;
const catalogs: Partial<Record<Language, Messages>> = {};
const patterns: Partial<Record<Language, [string, string][]>> = {};
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
          patterns[code] = Object.entries(catalogs[code]!)
            .filter(([source, target]) => source && source !== target && /^[\x20-\x7e]+$/.test(source))
            .sort(([a], [b]) => b.length - a.length);
          if ('name' in data && typeof data.name === 'string') names[code] = data.name;
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
  const exact = messages[text];
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
