import { useEffect, useRef, useState } from 'react';
import { BootProgress } from './components/BootProgress.tsx';
import { Clock } from './components/Clock.tsx';
import { Composer } from './components/Composer.tsx';
import { Credentials } from './components/Credentials.tsx';
import { DjCard } from './components/DjCard.tsx';
import { DjFeed, turnsOf } from './components/DjFeed.tsx';
import { OnAir } from './components/OnAir.tsx';
import { Profile } from './components/Profile.tsx';
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
  const [credOpen, setCredOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // 听过哪几条：决定入口写 PLAY 还是 REPLAY。会话内有效，刷新即归零（feed 本来也是会话内的）。
  // 口播的播放状态不在这里 —— 它在 useRadio 的管道里（ADR-0029），界面开不开都不改变它。
  const [heard, setHeard] = useState<ReadonlySet<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  // 开机自动进口播界面只来一次；用户自己开口（或在别处点过歌）之后就不再抢屏幕。
  const autoOpenRef = useRef(true);

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

  // ♡ 喜欢当前这首；FAV 把 QUEUE 面板就地换成喜欢列表（需求 3.7 决策 6、7）。
  const onLike = () => {
    if (radio.current) radio.favorite(radio.current, !radio.liked);
  };
  // 口播入口：点 PLAY / REPLAY 也要把音乐放起来（用户定），并从这一条说起。
  const openOral = (id: string) => {
    const entry = radio.feed.find((item) => item.id === id);
    const line = entry === undefined ? undefined : turnsOf(entry)[0];
    if (line === undefined) return;
    if (!radio.playing) radio.toggle();
    setHeard((prev) => new Set(prev).add(id));
    radio.playOral(line);
  };

  // 开机进台（用户定）：第一条口播一到就打开口播界面。只自动开这一次 ——
  // 之后切歌换口播由 useRadio 的管道接手（连续），这里只认「第一条」这一下。
  useEffect(() => {
    if (!autoOpenRef.current || radio.oralOpen) return;
    const first = radio.feed.find((entry) => turnsOf(entry).length > 0);
    if (first === undefined) return;
    autoOpenRef.current = false;
    openOral(first.id);
  }, [radio.oralOpen, radio.feed]);

  // 说过的就算「听过」：入口于是从 PLAY 变 REPLAY（用户定）。管道里说到哪条，这里就记哪条。
  useEffect(() => {
    const last = radio.oralLines[radio.oralLines.length - 1];
    if (last === undefined) return;
    const entry = radio.feed.find((item) => turnsOf(item)[0] === last);
    if (entry === undefined) return;
    setHeard((prev) => (prev.has(entry.id) ? prev : new Set(prev).add(entry.id)));
  }, [radio.oralLines, radio.feed]);

  return (
    <div className="viewport">
      <div className="stage">
        <div className="shell">
          <TopBar theme={theme} onTheme={setTheme} onDj={() => setDjOpen(true)} onLogin={() => setCredOpen(true)} />

          <Clock onAir={radio.now?.onAir ?? false} degraded={radio.now?.degraded ?? false} />

          <Transport
            track={radio.current}
            djState={radio.now?.djState}
            playing={radio.playing}
            positionMs={radio.positionMs}
            durationMs={radio.durationMs}
            volume={radio.volume}
            queueShown={queueShown}
            liked={radio.liked}
            onToggle={radio.toggle}
            onStop={radio.stop}
            onSkip={radio.skip}
            onBack={radio.back}
            onVolume={radio.setVolume}
            onToggleQueue={() => setQueueShown((prev) => !prev)}
            onLike={onLike}
          />

          {queueShown && (
            <Queue
              queue={radio.queue}
              favorites={radio.favorites}
              source={radio.source}
              currentId={radio.current?.id ?? null}
              onPlay={radio.play}
              onFavorite={radio.favorite}
              onSource={radio.setSource}
            />
          )}

          <DjFeed
            feed={radio.feed}
            live={radio.live}
            speaking={radio.now?.djState === 'speaking'}
            currentId={radio.current?.id ?? null}
            onPlay={radio.play}
            heard={heard}
            onOral={openOral}
          />

          <Composer
            onSay={(text) => {
              autoOpenRef.current = false;
              radio.say(text);
            }}
            busy={busy}
            inputRef={inputRef}
          />

          <footer className="statusbar">
            <span>EDGERUNNER FM</span>
            <span>
              <i className={radio.live ? 'dot' : 'dot off'} /> {radio.live ? 'CONNECTED' : 'RECONNECTING'}
            </span>
          </footer>
        </div>

        {/* 开机进度档在主界面前面；它自己决定什么时候淡出（ADR-0032）。 */}
        <BootProgress progress={radio.progress} />

        {radio.error && (
          <div className="banner" role="status">
            <span className="code">{radio.error.code}</span>
            <span className="text">{ERROR_COPY[radio.error.code] ?? radio.error.message}</span>
            <button className="dismiss" type="button" onClick={radio.dismissError}>
              DISMISS
            </button>
          </div>
        )}

        {djOpen && (
          <DjCard
            taste={radio.taste}
            onClose={() => setDjOpen(false)}
            // 打开 Profile 就关掉 DjCard：弹层永远只有一层，Esc 不会一次关两个。
            onMore={() => {
              setDjOpen(false);
              setProfileOpen(true);
            }}
          />
        )}

        {credOpen && <Credentials onClose={() => setCredOpen(false)} />}

        {profileOpen && <Profile onClose={() => setProfileOpen(false)} onPlay={radio.play} />}

        {radio.oralOpen && (
          <OnAir
            lines={radio.oralLines}
            track={radio.current}
            playing={radio.playing}
            positionMs={radio.positionMs}
            durationMs={radio.durationMs}
            oralPlaying={radio.oralPlaying}
            oralMs={radio.oralMs}
            onToggleSong={radio.toggle}
            onToggleOral={radio.toggleOral}
            onSeekOral={radio.seekOral}
            onClose={radio.closeOral}
          />
        )}

      </div>
    </div>
  );
}