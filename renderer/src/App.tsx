import { useEffect, useRef, useState } from 'react';
import { Clock } from './components/Clock.tsx';
import { Composer } from './components/Composer.tsx';
import { DjCard } from './components/DjCard.tsx';
import { DjFeed } from './components/DjFeed.tsx';
import { Queue } from './components/Queue.tsx';
import { TopBar } from './components/TopBar.tsx';
import { Transport } from './components/Transport.tsx';
import { useRadio } from './hooks/useRadio.ts';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'edgerunner.theme';

/* 设计画布 = 参考源口播卡片的真值（用户定的基准尺寸）。整块等比缩放，布局一行不折。 */
const STAGE = { width: 616, height: 876 };

const readTheme = (): Theme => (localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');

// 错误码是封闭枚举（抽象层第 5 节），所以每个码都要有一句人话 —— 包括「还差什么」。
const ERROR_COPY: Record<string, string> = {
  NO_LLM_KEY: 'No brain configured yet. Open LOGIN and paste an API key — until then the DJ cannot think.',
  MUSIC_SOURCE_UNREACHABLE: 'The music source is not answering. Only what is cached locally can play.',
  MUSIC_NOT_RESOLVABLE: 'That track has no playable URL. Skipping it.',
  TTS_FAILED: 'Voice synthesis failed. Lines still show up as text.',
  RATE_LIMITED: 'The provider is rate limiting us. It will retry.',
  INTERNAL: 'Something broke inside the station.',
};

export function App() {
  const radio = useRadio();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [queueShown, setQueueShown] = useState(true);
  const [djOpen, setDjOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // 等比缩放：只在这里算一次，CSS 只吃 --scale。窗口怎么拉，界面都是同一个 616×876。
  useEffect(() => {
    const fit = () => {
      const scale = Math.min(window.innerWidth / STAGE.width, window.innerHeight / STAGE.height);
      document.documentElement.style.setProperty('--scale', String(scale));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const busy = radio.now?.djState === 'thinking' || radio.now?.djState === 'speaking';

  return (
    <div className="viewport">
      <div className="stage">
        <div className="shell">
          <TopBar theme={theme} onTheme={setTheme} onDj={() => setDjOpen(true)} />

          <Clock onAir={radio.now?.onAir ?? false} degraded={radio.now?.degraded ?? false} />

          <Transport
            track={radio.current}
            djState={radio.now?.djState}
            playing={radio.playing}
            positionMs={radio.positionMs}
            durationMs={radio.durationMs}
            volume={radio.volume}
            queueShown={queueShown}
            onToggle={radio.toggle}
            onStop={radio.stop}
            onSkip={radio.skip}
            onBack={radio.back}
            onVolume={radio.setVolume}
            onToggleQueue={() => setQueueShown((prev) => !prev)}
          />

          {queueShown && (
            <Queue queue={radio.queue} currentId={radio.current?.id ?? null} onPlay={radio.play} />
          )}

          <DjFeed
            feed={radio.feed}
            live={radio.live}
            speaking={radio.now?.djState === 'speaking'}
            currentId={radio.current?.id ?? null}
            onPlay={radio.play}
            onReply={() => inputRef.current?.focus()}
          />

          <Composer onSay={radio.say} busy={busy} inputRef={inputRef} />

          <footer className="statusbar">
            <span>EDGERUNNER FM</span>
            <span>
              <i className={radio.live ? 'dot' : 'dot off'} /> {radio.live ? 'CONNECTED' : 'RECONNECTING'}
            </span>
          </footer>
        </div>

        {radio.error && (
          <div className="banner" role="status">
            <span className="code">{radio.error.code}</span>
            <span className="text">{ERROR_COPY[radio.error.code] ?? radio.error.message}</span>
            <button className="dismiss" type="button" onClick={radio.dismissError}>
              DISMISS
            </button>
          </div>
        )}

        {djOpen && <DjCard taste={radio.taste} onClose={() => setDjOpen(false)} />}
      </div>
    </div>
  );
}