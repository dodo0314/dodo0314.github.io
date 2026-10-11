const periodCalendar = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const periodStamp = date => [date.getUTCFullYear(), String(date.getUTCMonth()+1).padStart(2,'0'), String(date.getUTCDate()).padStart(2,'0')].join('-');
const periodDayLabel = date => `${date.getUTCFullYear()}년 ${date.getUTCMonth()+1}월 ${date.getUTCDate()}일`;

export function periodGroup(value, unit = 'day') {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return {key:'unknown',label:'날짜 없는 순간'};
  const fields = Object.fromEntries(periodCalendar.formatToParts(date).map(part => [part.type,part.value]));
  const local = new Date(Date.UTC(Number(fields.year),Number(fields.month)-1,Number(fields.day)));
  if (unit === 'year') return {key:`year:${fields.year}`,label:`${fields.year}년`};
  if (unit === 'month') return {key:`month:${fields.year}-${fields.month}`,label:`${fields.year}년 ${Number(fields.month)}월`};
  if (unit === 'week') {
    local.setUTCDate(local.getUTCDate() - (local.getUTCDay()+6)%7);
    const end = new Date(local); end.setUTCDate(end.getUTCDate()+6);
    const endLabel = local.getUTCFullYear() !== end.getUTCFullYear() ? periodDayLabel(end) : local.getUTCMonth() !== end.getUTCMonth() ? `${end.getUTCMonth()+1}월 ${end.getUTCDate()}일` : `${end.getUTCDate()}일`;
    return {key:`week:${periodStamp(local)}`,label:`${periodDayLabel(local)} ~ ${endLabel}`};
  }
  return {key:`day:${periodStamp(local)}`,label:periodDayLabel(local)};
}
