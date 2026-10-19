import type { Theme } from '../App.tsx';

const THEMES = ['dark', 'light'] as const;

/** ① 顶栏。头像点开 DJ 详情；LOGIN 点开凭证弹窗（3.9）。 */
export function TopBar({
  theme,
  onTheme,
  onDj,
  onLogin,
}: {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onDj: () => void;
  onLogin: () => void;
}) {
  return (
    <header className="topbar">
      <button className="avatar" type="button" onClick={onDj} aria-label="Open DJ profile">
        E
      </button>
      <span className="wordmark">EdgeRunner</span>
      <div className="right">
        <button className="pill" type="button" onClick={onLogin} title="API keys and the Netease cookie">
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