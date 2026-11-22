// Keep the original calendar day even if the phone crosses midnight in a different time zone.
export function nextMorningDate(createdAt: number) {
  const date = new Date(createdAt);
  date.setHours(9, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
