import { useEffect, useState } from 'react';
import { Clock } from './components/Clock.tsx';
import { Composer } from './components/Composer.tsx';
import { DjFeed } from './components/DjFeed.tsx';
import { Queue } from './components/Queue.tsx';
import { Transport } from './components/Transport.tsx';
import { useRadio } from './hooks/useRadio.ts';

type Theme = 'dark' | 'light';

const THEME_KEY = 'edgerunner.theme';

const readTheme = (): Theme => (localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');

// 错误码是封闭枚举（抽象层第 5 节），所以每个码都要有一句人话 —— 包括「还差什么」。
const ERROR_COPY: Record<string, string> = {
  NO_LLM_KEY: 'No LLM key configured yet. Settings arrives in 3.2 — until then the DJ cannot think.',
  MUSIC_SOURCE_UNREACHABLE: 'The music source is not answering. Only what is cached locally can play.',
  MUSIC_NOT_RESOLVABLE: 'That track has no playable URL. Skipping it.',
  TTS_FAILED: 'Voice synthesis failed. Lines still show up as text.',
  RATE_LIMITED: 'The provider is rate limiting us. It will retry.',
  INTERNAL: 'Something broke inside the station.',
};

export function App() {
  const radio = useRadio();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [feedHidden, setFeedHidden] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const busy = radio.now?.djState === 'thinking' || radio.now?.djState === 'speaking';

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">EDGERUNNER</span>
        <div className="theme-switch">
          {(['dark', 'light'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {radio.error && (
        <div className="banner" role="status">
          <span className="code">{radio.error.code}</span>
          <span>{ERROR_COPY[radio.error.code] ?? radio.error.message}</span>
          <button className="text-btn" type="button" onClick={radio.dismissError}>
            DISMISS
          </button>
        </div>
      )}

      <Clock onAir={radio.now?.onAir ?? false} degraded={radio.now?.degraded ?? false} />

      <Transport
        track={radio.current}
        djState={radio.now?.djState}
        onAir={radio.now?.onAir ?? false}
        playing={radio.playing}
        positionMs={radio.positionMs}
        durationMs={radio.durationMs}
        lyric={radio.lyric}
        lyricIndex={radio.lyricIndex}
        volume={radio.volume}
        feedHidden={feedHidden}
        onToggle={radio.toggle}
        onSkip={radio.skip}
        onBack={radio.back}
        onVolume={radio.setVolume}
        onToggleFeed={() => setFeedHidden((prev) => !prev)}
      />

      <div className="panels">
        <Queue queue={radio.queue} currentId={radio.current?.id ?? null} />
        <DjFeed feed={radio.feed} hidden={feedHidden} live={radio.live} />
      </div>

      <Composer onSay={radio.say} busy={busy} />

      <footer className="statusbar">
        <span>EDGERUNNER FM</span>
        <span className="side">
          <i className={radio.live ? 'dot' : 'dot off'} />
          {radio.live ? 'CONNECTED' : 'RECONNECTING'}
        </span>
      </footer>
    </div>
  );
}