import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodGroup } from '../public/period.mjs';

test('day, month and year grouping follow the Korea calendar across UTC midnight', () => {
  const date = '2025-12-31T15:00:00Z';
  assert.deepEqual(periodGroup(date), { key:'day:2026-01-01', label:'2026년 1월 1일' });
  assert.deepEqual(periodGroup(date, 'month'), { key:'month:2026-01', label:'2026년 1월' });
  assert.deepEqual(periodGroup(date, 'year'), { key:'year:2026', label:'2026년' });
  assert.equal(periodGroup('2025-12-31T14:59:59Z').key, 'day:2025-12-31');
});

test('weeks run Monday through Sunday and move together across month and year boundaries', () => {
  const week = { key:'week:2025-12-29', label:'2025년 12월 29일 ~ 2026년 1월 4일' };
  assert.deepEqual(periodGroup('2025-12-29T00:00:00+09:00', 'week'), week);
  assert.deepEqual(periodGroup('2026-01-04T23:59:59+09:00', 'week'), week);
  assert.deepEqual(periodGroup('2026-01-05T00:00:00+09:00', 'week'), {
    key:'week:2026-01-05', label:'2026년 1월 5일 ~ 11일'
  });
  assert.deepEqual(periodGroup('2025-09-01T00:00:00+09:00', 'week'), {
    key:'week:2025-09-01', label:'2025년 9월 1일 ~ 7일'
  });
  assert.deepEqual(periodGroup('2025-04-30T12:00:00+09:00', 'week'), {
    key:'week:2025-04-28', label:'2025년 4월 28일 ~ 5월 4일'
  });
});

test('missing and invalid dates share one unknown group for every period', () => {
  for (const unit of ['day', 'week', 'month', 'year']) {
    for (const date of [null, undefined, '', 'invalid-date']) {
      assert.deepEqual(periodGroup(date, unit), { key:'unknown', label:'날짜 없는 순간' });
    }
  }
});
