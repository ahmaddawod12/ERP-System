function getTargetMonth(now = new Date(), monthsLookback = 6) {
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  let targetMonth = currentMonth - monthsLookback;
  let targetYear = currentYear;

  while (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }

  const startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));

  return { year: targetYear, month: targetMonth, startDate, endDate };
}

module.exports = {
  getTargetMonth,
};
