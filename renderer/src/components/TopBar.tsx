import type { Theme } from '../App.tsx';

const THEMES = ['dark', 'light'] as const;

/** ① 顶栏。头像点开 DJ 详情；LOGIN 点开凭证弹窗（3.9 才接上）。 */
export function TopBar({
  theme,
  onTheme,
  onDj,
}: {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onDj: () => void;
}) {
  return (
    <header className="topbar">
      <button className="avatar" type="button" onClick={onDj} aria-label="Open DJ profile">
        E
      </button>
      <span className="wordmark">EdgeRunner</span>
      <div className="right">
        <button className="pill" type="button" aria-disabled="true" title="Credentials arrive in 3.9">
          LOGIN
        </button>
        <div className="seg">
          {THEMES.map((value) => (
            <button key={value} type="button" aria-pressed={theme === value} onClick={() => onTheme(value)}>
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}