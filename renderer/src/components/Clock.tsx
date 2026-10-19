import { useEffect, useState } from 'react';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (value: number) => String(value).padStart(2, '0');

/** ② 大钟区。点阵大钟（Doto）+ 星期 + 日期 + ON AIR。 */
export function Clock({ onAir, degraded }: { onAir: boolean; degraded: boolean }) {
  const [at, setAt] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setAt(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="clock-panel">
      <div className="clock">
        {pad(at.getHours())}:{pad(at.getMinutes())}
      </div>
      <div className="clock-day">{WEEKDAYS[at.getDay()]}</div>
      <div className="clock-date">
        {at.getDate()} {MONTHS[at.getMonth()]} {at.getFullYear()}
      </div>
      <div className="clock-air">
        <i className={onAir ? 'dot' : 'dot off'} />
        {onAir ? 'ON AIR' : 'OFF AIR'}
        {degraded && <span className="badge">DEGRADED</span>}
      </div>
    </div>
  );
}