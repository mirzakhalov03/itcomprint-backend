import type { BusRoute } from '../models/event.model';

type Lang = 'en' | 'uz' | 'ru';

// Any answer naming a bus counts; "bus" must stand alone (not "Busan"), the others take suffixes (avtobusda).
const BUS_WORD = /(?<![\p{L}])(bus(?![\p{L}])|avtobus\p{L}*|автобус\p{L}*)/iu;

// Connective words around the city, across the languages the bot and sheet use.
const FILLER = new Set([
  'from',
  'by',
  'via',
  'with',
  'dan',
  'den',
  'bilan',
  'penen',
  'menen',
  'из',
  'на',
  'с',
]);

const MAX_CITY_WORDS = 3;

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

const langOf = (word: string): Lang =>
  /^bus$/i.test(word) ? 'en' : /^автобус/i.test(word) ? 'ru' : 'uz';

export function parseBusPhrase(value: string): { lang: Lang; city: string } | null {
  const match = BUS_WORD.exec(value);
  if (!match) return null;
  const words = value
    .replace(match[0], ' ')
    .split(/[^\p{L}'ʻʼ‘’`-]+/u)
    .filter((w) => w && !FILLER.has(w.toLowerCase()));
  // Uzbek ablative glued to the city ("Toshkentdan"); needs 3+ letters before it.
  const last = words.length - 1;
  if (last >= 0) words[last] = words[last].replace(/(?<=\p{L}{3})(dan|den)$/iu, '');
  // Long leftovers are free text that happens to mention a bus, not a city.
  if (words.length === 0 || words.length > MAX_CITY_WORDS) return null;
  return { lang: langOf(match[1]), city: words.join(' ') };
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

// Karakalpak/Uzbek "from" endings (-dan/-tan/-nan…). Not stripped from the label, since
// real names end this way too (Gulistan); instead each city also gets a suffix-free key.
const ABLATIVE = /(dan|den|tan|ten|nan|nen)$/i;

const skeletonsOf = (phrase: string): string[] => {
  const parsed = parseBusPhrase(phrase);
  if (!parsed) return [];
  const stem = parsed.city.replace(ABLATIVE, '');
  const keys = [citySkeleton(parsed.city)];
  if (stem.length >= 3 && stem !== parsed.city) keys.push(citySkeleton(stem));
  return keys;
};

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// One slip tolerated, but only on longer skeletons: short ones differ by a letter between real cities.
const sameCity = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && editDistance(a, b) <= 1);

function labelFor(phrases: string[]): string {
  const parsed = phrases.map(parseBusPhrase);
  for (const lang of LABEL_PREFERENCE) {
    const hit = parsed.find((p) => p?.lang === lang);
    if (!hit) continue;
    // "Moynaqtan" → "Moynaq" when another phrase confirms the ending isn't part of the name.
    const stem = hit.city.replace(ABLATIVE, '');
    const confirmed = parsed.some(
      (p) => p && p !== hit && sameCity(citySkeleton(p.city), citySkeleton(stem)),
    );
    return stem.length >= 3 && confirmed ? stem : hit.city;
  }
  return phrases[0];
}

/**
 * Places bus phrases no route holds yet: into a route with the similar city skeleton,
 * else a new route. Additive only — never moves a placed phrase, renames a
 * human-set label, duplicates a label, or removes anything, so edits made in the
 * app survive every sync.
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
    const keys = skeletonsOf(value);
    if (keys.length === 0) continue;
    const route = next.find((r) =>
      r.phrases.some((p) => skeletonsOf(p).some((o) => keys.some((k) => sameCity(o, k)))),
    );
    if (route) route.phrases.push(value);
    else next.push({ label: '', autoLabel: true, phrases: [value], hidden: false });
    placed.add(value);
    changed = true;
  }

  // Labels stay unique (case-insensitive), matching the PATCH invariant the UI relies on.
  const taken = (label: string, self: BusRoute) =>
    next.some((r) => r !== self && r.label.toLowerCase() === label.toLowerCase());

  for (const route of next) {
    if (!route.autoLabel) continue;
    const label = labelFor(route.phrases);
    if (label === route.label) continue;
    const clash = taken(label, route);
    // Rather keep a labelled route's current name than duplicate another route's.
    if (clash && route.label) continue;
    route.label = clash ? freeLabel(label, (l) => taken(l, route)) : label;
    changed = true;
  }
  return { routes: next, changed };
}

function freeLabel(base: string, isTaken: (label: string) => boolean): string {
  let label = base;
  for (let n = 2; isTaken(label); n++) label = `${base} (${n})`;
  return label;
}
