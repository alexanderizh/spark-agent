import { pathToFileURL } from 'node:url'

const WORKDAY_START_MINUTES = 9 * 60
const WORKDAY_END_MINUTES = 19 * 60

export function isCommitBlocked(date) {
  const dayOfWeek = date.getDay()
  const minutesSinceMidnight = date.getHours() * 60 + date.getMinutes()

  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  const isWorkingHours =
    minutesSinceMidnight >= WORKDAY_START_MINUTES && minutesSinceMidnight < WORKDAY_END_MINUTES

  return isWeekday && isWorkingHours
}

const now = new Date()

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (isCommitBlocked(now)) {
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')

    console.error(
      `[commit-time] 提交已阻止：当前时间为工作日 ${hours}:${minutes}，` +
        '工作日 09:00-19:00 不允许提交。需要提交时请使用 git commit -n。',
    )
    process.exitCode = 1
  }
}
