/**
 * Business-day boundaries in the configured business time zone
 * (REPORT_TIME_ZONE, default Europe/Istanbul). Shared by reports, the cash
 * register / Z-report and the ledger's closed-day guard so they all agree
 * on what "today" is.
 */
const DEFAULT_TIME_ZONE = 'Europe/Istanbul';

function businessTimeZone() {
  return process.env.REPORT_TIME_ZONE || DEFAULT_TIME_ZONE;
}

/** UTC instant of local midnight for a calendar date (Date at 00:00 UTC carrying y/m/d). */
function zonedMidnightUtc(calendarDate, timeZone = businessTimeZone()) {
  const target = calendarDate.getTime();
  let guess = new Date(target);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(guess).map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess = new Date(guess.getTime() - (represented - target));
  }
  return guess;
}

/** 'YYYY-MM-DD' of an instant in the business time zone. */
function localDateString(instant = new Date(), timeZone = businessTimeZone()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** [start, end) UTC instants of a local calendar day 'YYYY-MM-DD'. */
function localDayRange(dateString, timeZone = businessTimeZone()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString));
  if (!match) throw new Error('Tarih YYYY-MM-DD biçiminde olmalıdır');
  const [, y, m, d] = match.map(Number);
  const startCalendar = new Date(Date.UTC(y, m - 1, d));
  const endCalendar = new Date(Date.UTC(y, m - 1, d + 1));
  return { start: zonedMidnightUtc(startCalendar, timeZone), end: zonedMidnightUtc(endCalendar, timeZone) };
}

module.exports = { DEFAULT_TIME_ZONE, businessTimeZone, zonedMidnightUtc, localDateString, localDayRange };
