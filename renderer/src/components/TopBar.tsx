import type { Theme } from '../App.tsx';
import { Icon } from './Icon.tsx';

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
  // 无边框窗口没有系统关闭键，所以这一枚必须存在。关窗走主进程（main/preload.ts 的桥）。
  const close = () => {
    if (window.__RADIO__?.close) window.__RADIO__.close();
    else window.close();
  };

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
        <button className="close" type="button" onClick={close} aria-label="Close EdgeRunner" title="Close">
          <Icon name="close" size={13} />
        </button>
      </div>
    </header>
  );
}