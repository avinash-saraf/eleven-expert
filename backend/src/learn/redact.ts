// Removes personal data from anything the apprentice stores or shows: transcripts,
// captions, questions and knowledge. Pattern based, so it catches structured identifiers
// (emails, phone numbers, bank accounts, cards). Names are handled by the vision and
// knowledge prompts, which refer to people by role.
const PATTERNS: Array<[string, RegExp]> = [
  ['EMAIL', /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi],
  [
    'IBAN',
    /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){2,7}(?:[ -]?[A-Z0-9]{1,4})?\b/g,
  ],
  ['ID', /\b\d{3}-\d{2}-\d{4}\b/g],
  ['PHONE', /(?<![\w])(?:\+|00)\d[\d\s().-]{7,}\d/g],
];
const CARD = /\b(?:\d[ -]?){13,19}\b/g;

function luhn(digits: string) {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alternate && (n *= 2) > 9) n -= 9;
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text.replace(CARD, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return match;
    count++;
    return '[CARD]';
  });
  for (const [label, pattern] of PATTERNS)
    out = out.replace(pattern, () => {
      count++;
      return `[${label}]`;
    });
  return { text: out, count };
}

export type SensitiveBox = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

// Keeps only boxes that sit on the frame, so a bad coordinate cannot crash the blur.
export function usableBoxes(value: unknown): SensitiveBox[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (b) =>
        b &&
        [b.x, b.y, b.width, b.height].every(
          (n: unknown) => typeof n === 'number' && Number.isFinite(n),
        ) &&
        b.width > 0 &&
        b.height > 0 &&
        b.x >= 0 &&
        b.y >= 0 &&
        b.x < 1 &&
        b.y < 1,
    )
    .slice(0, 12)
    .map((b) => ({
      label: String(b.label ?? 'personal data').slice(0, 40),
      x: b.x,
      y: b.y,
      width: Math.min(b.width, 1 - b.x),
      height: Math.min(b.height, 1 - b.y),
    }));
}
