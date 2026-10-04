import { redact, usableBoxes } from './redact';

describe('redact', () => {
  it('removes emails, phone numbers and IBANs', () => {
    const { text, count } = redact(
      'Mail anke.vogel@kraus-maschinenbau.example or call +49 711 5550142, pay DE89 3704 0044 0532 0130 00.',
    );
    expect(text).toBe('Mail [EMAIL] or call [PHONE], pay [IBAN].');
    expect(count).toBe(3);
  });

  it('removes real card numbers but keeps amounts and invoice numbers', () => {
    expect(redact('card 4111 1111 1111 1111').text).toBe('card [CARD]');
    expect(redact('INV-4471 for €6,480.00 over 5000').text).toBe(
      'INV-4471 for €6,480.00 over 5000',
    );
  });

  it('leaves ordinary sentences alone', () => {
    const sentence = 'Equipment over 5000 euros is always capex.';
    expect(redact(sentence)).toEqual({ text: sentence, count: 0 });
  });
});

describe('usableBoxes', () => {
  it('drops malformed boxes and clamps to the frame', () => {
    const boxes = usableBoxes([
      { label: 'iban', x: 0.6, y: 0.5, width: 0.7, height: 0.1 },
      { label: 'bad', x: 'a', y: 0, width: 1, height: 1 },
      { label: 'off', x: 1.2, y: 0, width: 0.1, height: 0.1 },
    ]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].width).toBeCloseTo(0.4);
  });
});
