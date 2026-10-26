import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  TemplateContext,
  formatDateTime,
  isValidDateKey,
  isValidTimeZone,
  prettifyEmailName,
  renderTemplate,
  resolveTimeZone,
  serverTimeZone,
  todayIn,
  zonedParts,
} from './template-renderer';

// Thursday 2026-03-05 14:07:09 UTC.
const NOW = new Date('2026-03-05T14:07:09Z');

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    title: 'Kickoff',
    author: 'Jane Doe',
    authorEmail: 'jane.doe@example.com',
    now: NOW,
    timeZone: 'UTC',
    ...overrides,
  };
}

const render = (source: string, overrides: Partial<TemplateContext> = {}) =>
  renderTemplate(source, ctx(overrides));

describe('renderTemplate — variables', () => {
  it('replaces title, date, time, author and author_email', () => {
    assert.equal(
      render('# {{title}}\n{{date}} {{time}} by {{author}} <{{author_email}}>'),
      '# Kickoff\n2026-03-05 14:07 by Jane Doe <jane.doe@example.com>',
    );
  });

  it('accepts surrounding spaces and any case in the variable name', () => {
    assert.equal(render('{{ title }}|{{DATE}}|{{ Time }}|{{Author_Email}}'), 'Kickoff|2026-03-05|14:07|jane.doe@example.com');
  });

  it('formats date and time with an explicit format, trimming it', () => {
    assert.equal(render('{{date:DD/MM/YYYY}}'), '05/03/2026');
    assert.equal(render('{{time:HH:mm:ss}}'), '14:07:09');
    assert.equal(render('{{date: YYYY }}'), '2026');
    // date and time format the same instant
    assert.equal(render('{{time:YYYY-MM-DD}}'), '2026-03-05');
    assert.equal(render('{{date:h A}}'), '2 PM');
  });

  it('falls back to the default format for an empty format', () => {
    assert.equal(render('{{date:}} {{time:}}'), '2026-03-05 14:07');
  });

  it('leaves unknown variables untouched', () => {
    assert.equal(render('{{weather}} and {{ tomorrow }} and {{date+1d}}'), '{{weather}} and {{ tomorrow }} and {{date+1d}}');
  });

  it('leaves a format on a non-date variable untouched', () => {
    assert.equal(render('{{title:upper}} {{author:x}} {{author_email:y}}'), '{{title:upper}} {{author:x}} {{author_email:y}}');
  });

  it('leaves malformed braces alone', () => {
    assert.equal(render('{title} {{title} {{ }} {{}}'), '{title} {{title} {{ }} {{}}');
  });

  it('does not re-scan substituted values', () => {
    assert.equal(render('# {{title}}', { title: 'Plan {{date}} $& $1' }), '# Plan {{date}} $& $1');
  });

  it('replaces every occurrence', () => {
    assert.equal(render('{{title}}/{{title}}'), 'Kickoff/Kickoff');
  });

  it('keeps surrounding markdown and frontmatter intact', () => {
    const source = '---\ncreated: {{date}}\ntags: [meeting]\n---\n\n## {{title}}\n\n- [ ] item\n';
    assert.equal(render(source), '---\ncreated: 2026-03-05\ntags: [meeting]\n---\n\n## Kickoff\n\n- [ ] item\n');
  });
});

describe('formatDateTime — tokens', () => {
  const p = zonedParts(NOW, 'UTC');

  const cases: [string, string][] = [
    ['YYYY', '2026'],
    ['YY', '26'],
    ['MMMM', 'March'],
    ['MMM', 'Mar'],
    ['MM', '03'],
    ['M', '3'],
    ['DD', '05'],
    ['D', '5'],
    ['Do', '5th'],
    ['dddd', 'Thursday'],
    ['ddd', 'Thu'],
    ['HH', '14'],
    ['H', '14'],
    ['hh', '02'],
    ['h', '2'],
    ['mm', '07'],
    ['ss', '09'],
    ['A', 'PM'],
    ['a', 'pm'],
  ];
  for (const [token, expected] of cases) {
    it(`${token} → ${expected}`, () => {
      assert.equal(formatDateTime(p, token), expected);
    });
  }

  it('combines tokens with punctuation', () => {
    assert.equal(formatDateTime(p, 'dddd, MMMM Do YYYY [at] h:mm A'), 'Thursday, March 5th 2026 at 2:07 PM');
  });

  it('treats [bracketed] text as literal, including token letters', () => {
    assert.equal(formatDateTime(p, '[Week of] MMM D [YYYY]'), 'Week of Mar 5 YYYY');
    assert.equal(formatDateTime(p, '[]YYYY'), '2026');
  });

  it('copies characters that are not tokens', () => {
    assert.equal(formatDateTime(p, 'YYYY/MM/DD xyz'), '2026/03/05 xyz');
  });

  it('pads small values and handles midnight and noon in 12-hour tokens', () => {
    const midnight = zonedParts(new Date('2026-01-02T00:03:04Z'), 'UTC');
    assert.equal(formatDateTime(midnight, 'HH H hh h A a'), '00 0 12 12 AM am');
    const noon = zonedParts(new Date('2026-01-02T12:00:00Z'), 'UTC');
    assert.equal(formatDateTime(noon, 'hh h A a'), '12 12 PM pm');
    assert.equal(formatDateTime(midnight, 'YYYY-MM-DD M/D'), '2026-01-02 1/2');
  });

  it('writes ordinals for every suffix class', () => {
    const ord = (day: number) => formatDateTime({ ...p, day }, 'Do');
    assert.deepEqual(
      [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24, 31].map(ord),
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '24th', '31st'],
    );
  });

  it('names every month and weekday', () => {
    const months = Array.from({ length: 12 }, (_, i) => formatDateTime({ ...p, month: i + 1 }, 'MMMM MMM'));
    assert.equal(months[0], 'January Jan');
    assert.equal(months[8], 'September Sep');
    assert.equal(months[11], 'December Dec');
    const days = Array.from({ length: 7 }, (_, i) => formatDateTime({ ...p, weekday: i }, 'dddd ddd'));
    assert.deepEqual(days, [
      'Sunday Sun', 'Monday Mon', 'Tuesday Tue', 'Wednesday Wed', 'Thursday Thu', 'Friday Fri', 'Saturday Sat',
    ]);
  });
});

describe('renderTemplate — timezones', () => {
  const lateEvening = new Date('2026-03-05T23:30:00Z');

  it('rolls the day forward east of UTC', () => {
    assert.equal(render('{{date}} {{time}} {{date:dddd}}', { now: lateEvening, timeZone: 'Asia/Tokyo' }), '2026-03-06 08:30 Friday');
  });

  it('keeps the earlier day west of UTC', () => {
    assert.equal(render('{{date}} {{time}}', { now: lateEvening, timeZone: 'America/Los_Angeles' }), '2026-03-05 15:30');
  });

  it('follows daylight saving time', () => {
    // Paris: UTC+1 in winter, UTC+2 in summer.
    assert.equal(render('{{time}}', { now: new Date('2026-01-15T12:00:00Z'), timeZone: 'Europe/Paris' }), '13:00');
    assert.equal(render('{{time}}', { now: new Date('2026-07-15T12:00:00Z'), timeZone: 'Europe/Paris' }), '14:00');
  });

  it('handles half-hour offsets', () => {
    assert.equal(render('{{time}}', { now: new Date('2026-03-05T00:00:00Z'), timeZone: 'Asia/Kolkata' }), '05:30');
  });
});

describe('renderTemplate — date override (daily notes)', () => {
  it('uses the given day for date tokens and the current time for time tokens', () => {
    assert.equal(
      render('{{title}} {{date}} {{date:dddd}} {{time}}', { title: '2026-12-25', date: '2026-12-25' }),
      '2026-12-25 2026-12-25 Friday 14:07',
    );
  });

  it('ignores an invalid override', () => {
    assert.equal(render('{{date}}', { date: '2026-02-30' }), '2026-03-05');
  });
});

describe('timezone helpers', () => {
  it('validates IANA names with Intl', () => {
    assert.equal(isValidTimeZone('Europe/Paris'), true);
    assert.equal(isValidTimeZone('UTC'), true);
    assert.equal(isValidTimeZone('Mars/Olympus'), false);
    assert.equal(isValidTimeZone(''), false);
    assert.equal(isValidTimeZone(undefined), false);
    assert.equal(isValidTimeZone(42), false);
  });

  it('falls back to the server timezone', () => {
    assert.equal(resolveTimeZone('Asia/Tokyo'), 'Asia/Tokyo');
    assert.equal(resolveTimeZone('Mars/Olympus'), serverTimeZone());
    assert.equal(resolveTimeZone(undefined), serverTimeZone());
    assert.equal(resolveTimeZone(null), serverTimeZone());
  });

  it('renders with an invalid timezone once resolved', () => {
    assert.match(render('{{date}}', { timeZone: resolveTimeZone('Mars/Olympus') }), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('computes today in a timezone', () => {
    const t = new Date('2026-03-05T23:30:00Z');
    assert.equal(todayIn('Asia/Tokyo', t), '2026-03-06');
    assert.equal(todayIn('UTC', t), '2026-03-05');
  });
});

describe('isValidDateKey', () => {
  it('accepts real dates only', () => {
    assert.equal(isValidDateKey('2026-03-05'), true);
    assert.equal(isValidDateKey('2028-02-29'), true);
    assert.equal(isValidDateKey('2026-02-29'), false);
    assert.equal(isValidDateKey('2026-02-30'), false);
    assert.equal(isValidDateKey('2026-13-01'), false);
    assert.equal(isValidDateKey('2026-3-5'), false);
    assert.equal(isValidDateKey('05/03/2026'), false);
    assert.equal(isValidDateKey('2026-03-05/../x'), false);
    assert.equal(isValidDateKey(undefined), false);
  });
});

describe('prettifyEmailName', () => {
  it('capitalizes the email local part split on . _ -', () => {
    assert.equal(prettifyEmailName('jane.doe@example.com'), 'Jane Doe');
    assert.equal(prettifyEmailName('first_last-name@x.io'), 'First Last Name');
    assert.equal(prettifyEmailName('bob@x.io'), 'Bob');
  });

  it('falls back to the email when the local part is only separators', () => {
    assert.equal(prettifyEmailName('._@x.io'), '._@x.io');
  });
});
