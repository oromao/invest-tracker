const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo'

function formatDateParts(timestamp: string) {
  const date = new Date(timestamp)
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
}

export function formatSaoPauloDateTime(timestamp: string): string {
  const parts = formatDateParts(timestamp)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${lookup.day}/${lookup.month}/${lookup.year} ${lookup.hour}:${lookup.minute}:${lookup.second}`
}

export function formatSaoPauloTime(timestamp: string): string {
  const parts = formatDateParts(timestamp)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${lookup.hour}:${lookup.minute}:${lookup.second}`
}
