export interface FormattedDateTime {
  date: string;
  time: string;
}

export const getFormattedDateTime = (): FormattedDateTime => {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");

  const isPM = hours >= 12;
  const period = isPM ? "PM" : "AM";

  hours = hours % 12 || 12;
  const formattedHours = String(hours).padStart(2, "0");

  return {
    date: `${year}-${month}-${day}`,
    time: `${period} ${formattedHours}:${minutes}`,
  };
};