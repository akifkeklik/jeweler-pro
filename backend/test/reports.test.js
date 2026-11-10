const test = require('node:test');
const assert = require('node:assert/strict');
const { periodRange } = require('../routes/reports');

function iso(date) {
  return date.toISOString();
}

test('daily report boundaries use the configured business timezone', () => {
  const now = new Date('2026-11-05T12:00:00.000Z');
  const range = periodRange('daily', false, now, 'Europe/Istanbul');
  assert.equal(iso(range.start), '2026-11-04T21:00:00.000Z');
  assert.equal(iso(range.end), '2026-11-05T21:00:00.000Z');
});

test('weekly report starts Monday in the configured business timezone', () => {
  const now = new Date('2026-11-05T12:00:00.000Z');
  const range = periodRange('weekly', false, now, 'Europe/Istanbul');
  assert.equal(iso(range.start), '2026-11-01T21:00:00.000Z');
  assert.equal(iso(range.end), '2026-11-08T21:00:00.000Z');
});

test('monthly and previous-month reports use local calendar boundaries', () => {
  const now = new Date('2026-11-05T12:00:00.000Z');
  const current = periodRange('monthly', false, now, 'Europe/Istanbul');
  const previous = periodRange('monthly', true, now, 'Europe/Istanbul');
  assert.equal(iso(current.start), '2026-10-31T21:00:00.000Z');
  assert.equal(iso(current.end), '2026-11-30T21:00:00.000Z');
  assert.equal(iso(previous.start), '2026-09-30T21:00:00.000Z');
  assert.equal(iso(previous.end), '2026-10-31T21:00:00.000Z');
});
