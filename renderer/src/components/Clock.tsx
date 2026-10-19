import { useEffect, useState } from 'react';

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (value: number) => String(value).padStart(2, '0');

/** 点阵大钟：整点跳的是数字，不是秒 —— 电台的钟只要「现在几点」。 */
export function Clock({ onAir, degraded }: { onAir: boolean; degraded: boolean }) {
  const [at, setAt] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setAt(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="clock-block">
      <div className="clock">
        {pad(at.getHours())}:{pad(at.getMinutes())}
      </div>
      <div className="clock-sub">
        <span>
          {WEEKDAYS[at.getDay()]} · {MONTHS[at.getMonth()]} {at.getDate()}
        </span>
        <span>
          <i className={onAir ? 'dot' : 'dot off'} /> {onAir ? 'ON AIR' : 'OFF AIR'}
        </span>
        {degraded && <span className="badge warn">DEGRADED</span>}
      </div>
    </div>
  );
}