import type { BusRoute } from '../models/event.model';

type Lang = 'en' | 'uz' | 'ru';

// The registration bot's fixed "coming by bus" wording, one per language.
const PATTERNS: [Lang, RegExp][] = [
  ['en', /^bus\s+from\s+(.+)$/i],
  ['uz', /^(.+?)dan\s+avtobusda$/i],
  ['ru', /^автобус\s+из\s+(.+)$/i],
];

// English first: that's the spelling shown on the chip.
const LABEL_PREFERENCE: Lang[] = ['en', 'uz', 'ru'];

const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  қ: 'k',
  ғ: 'g',
  ҳ: 'h',
  ў: 'o',
};

export function parseBusPhrase(value: string): { lang: Lang; city: string } | null {
  const text = value.trim();
  for (const [lang, pattern] of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { lang, city: match[1].trim() };
  }
  return null;
}

/**
 * Language-neutral key for a city name: transliterate, unify kh/q/dj, drop vowels.
 * Dropping vowels also strips Russian case endings (Кагана → kgn = Kogan).
 */
export function citySkeleton(city: string): string {
  const latin = [...city.toLowerCase().replace(/['ʻʼ‘’`]/g, '')]
    .map((ch) => CYRILLIC[ch] ?? ch)
    .join('');
  return latin
    .replace(/kh/g, 'x')
    .replace(/q/g, 'k')
    .replace(/dzh|dj/g, 'j')
    .replace(/[^a-z]/g, '')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const skeletonOf = (phrase: string) => {
  const parsed = parseBusPhrase(phrase);
  return parsed && citySkeleton(parsed.city);
};

function labelFor(phrases: string[]): string {
  const parsed = phrases.map(parseBusPhrase);
  for (const lang of LABEL_PREFERENCE) {
    const hit = parsed.find((p) => p?.lang === lang);
    if (hit) return hit.city;
  }
  return phrases[0];
}

/**
 * Places bus phrases no route holds yet: into a route with the same city skeleton,
 * else a new route. Additive only — never moves a placed phrase, renames a
 * human-set label, or removes anything, so edits made in the app survive every sync.
 */
export function mergeDetectedRoutes(
  routes: readonly BusRoute[],
  values: Iterable<string>,
): { routes: BusRoute[]; changed: boolean } {
  // Explicit fields: callers may pass Mongoose subdocuments, whose spread carries internals.
  const next = routes.map(({ label, autoLabel, phrases, hidden }) => ({
    label,
    autoLabel,
    phrases: [...phrases],
    hidden,
  }));
  const placed = new Set(next.flatMap((r) => r.phrases));
  let changed = false;

  for (const value of new Set(values)) {
    if (placed.has(value)) continue;
    const key = skeletonOf(value);
    if (!key) continue;
    const route = next.find((r) => r.phrases.some((p) => skeletonOf(p) === key));
    if (route) route.phrases.push(value);
    else next.push({ label: '', autoLabel: true, phrases: [value], hidden: false });
    placed.add(value);
    changed = true;
  }

  for (const route of next) {
    if (!route.autoLabel) continue;
    const label = labelFor(route.phrases);
    if (label !== route.label) {
      route.label = label;
      changed = true;
    }
  }
  return { routes: next, changed };
}
