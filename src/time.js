function validDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isValidCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return Boolean(match) && validDateParts(
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  );
}

export function isValidDateTimeMinute(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(
    String(value || '')
  );
  if (!match) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  return validDateParts(
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  ) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
