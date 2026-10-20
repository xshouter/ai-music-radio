import { useEffect, useState } from 'react';
import type { SettingsInput, SettingsView } from '../../../shared/api-types.ts';
import { ApiFailure, getSettings, putSettings } from '../api/client.ts';
import { Icon } from './Icon.tsx';

type Protocol = 'openai' | 'anthropic';

type Draft = {
  baseUrl: string;
  model: string;
  protocol: Protocol;
  llmKey: string;
  ttsProvider: string;
  ttsVoice: string;
  ttsBaseUrl: string;
  ttsKey: string;
  musicProvider: string;
  cookie: string;
};

const EMPTY: Draft = {
  baseUrl: '',
  model: '',
  protocol: 'openai',
  llmKey: '',
  ttsProvider: '',
  ttsVoice: '',
  ttsBaseUrl: '',
  ttsKey: '',
  musicProvider: '',
  cookie: '',
};

const PROTOCOLS: Protocol[] = ['openai', 'anthropic'];

/** 空字符串 = 「不改」：只把用户真填了的字段送出去，后端就不会把已有的 key / cookie 清掉（ADR-0005 / ADR-0011）。 */
const toInput = (draft: Draft): SettingsInput => ({
  llm: {
    baseUrl: draft.baseUrl.trim() || undefined,
    model: draft.model.trim() || undefined,
    protocol: draft.protocol,
    apiKey: draft.llmKey.trim() || undefined,
  },
  tts: {
    provider: draft.ttsProvider.trim() || undefined,
    voice: draft.ttsVoice.trim() || undefined,
    baseUrl: draft.ttsBaseUrl.trim() || undefined,
    apiKey: draft.ttsKey.trim() || undefined,
  },
  music: {
    provider: draft.musicProvider.trim() || undefined,
    cookie: draft.cookie.trim() || undefined,
  },
});

/**
 * ④ 凭证弹窗（3.9）。LOGIN 打开。三块：大脑（LLM）/ 嗓子（TTS）/ 音乐源（网易云 cookie）。
 * 明文只从这一头进去，**永不回显** —— 界面上只显示「配没配」（危险字段禁令 / ADR-0005 / ADR-0011）。
 */
export function Credentials({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [note, setNote] = useState<{ kind: 'plain' | 'ok' | 'err'; text: string }>({ kind: 'plain', text: 'LOADING' });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 进来先读一次：非明文字段（baseUrl / model / provider / voice）填好，明文字段永远留空。
  useEffect(() => {
    let alive = true;
    getSettings()
      .then((next) => {
        if (!alive) return;
        setView(next);
        setDraft((prev) => ({
          ...prev,
          baseUrl: next.llm.baseUrl,
          model: next.llm.model,
          protocol: next.llm.protocol,
          ttsProvider: next.tts.provider,
          ttsVoice: next.tts.voice,
          ttsBaseUrl: next.tts.baseUrl,
          musicProvider: next.music.provider,
        }));
        setNote({ kind: 'plain', text: 'STORED LOCALLY' });
      })
      .catch((cause: unknown) => {
        if (alive) setNote({ kind: 'err', text: cause instanceof ApiFailure ? cause.code : 'INTERNAL' });
      });
    return () => {
      alive = false;
    };
  }, []);

  const setField = (key: keyof Draft) => (value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setNote({ kind: 'plain', text: 'SAVING' });
    try {
      const next = await putSettings(toInput(draft));
      setView(next);
      setDraft((prev) => ({ ...prev, llmKey: '', ttsKey: '', cookie: '' }));
      setNote({ kind: 'ok', text: 'SAVED' });
    } catch (cause: unknown) {
      setNote({ kind: 'err', text: cause instanceof ApiFailure ? cause.code : 'INTERNAL' });
    }
  };

  const chip = (stored: boolean) => (stored ? <span className="cred-set">SET</span> : null);
  const keyHint = (stored: boolean) => (stored ? 'stored — type to replace' : 'paste your key');

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Credentials"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cred-card">
        <button className="cred-close" type="button" onClick={onClose} aria-label="Close">
          <Icon name="close" size={11} />
        </button>
        <div className="cred-title">Credentials</div>
        <p className="cred-note">
          Keys stay on this machine. Nothing you paste is ever sent back — a <span className="cred-set">SET</span> chip just
          means one is stored.
        </p>

        <div className="cred-block">
          <div className="h">
            THE BRAIN · LLM {chip(view?.llm.apiKeySet ?? false)}
          </div>
          <div className="cred-row">
            <label className="cred-field">
              <span className="l">BASE URL</span>
              <input
                value={draft.baseUrl}
                onChange={(event) => setField('baseUrl')(event.target.value)}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                spellCheck={false}
              />
            </label>
            <div className="cred-pair">
              <label className="cred-field">
                <span className="l">MODEL</span>
                <input value={draft.model} onChange={(event) => setField('model')(event.target.value)} placeholder="qwen-plus" spellCheck={false} />
              </label>
              <div className="cred-field">
                <span className="l">PROTOCOL</span>
                <div className="seg cred-seg">
                  {PROTOCOLS.map((value) => (
                    <button key={value} type="button" aria-pressed={draft.protocol === value} onClick={() => setField('protocol')(value)}>
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label className="cred-field">
              <span className="l">API KEY</span>
              <input
                type="password"
                value={draft.llmKey}
                onChange={(event) => setField('llmKey')(event.target.value)}
                placeholder={keyHint(view?.llm.apiKeySet ?? false)}
                autoComplete="off"
              />
            </label>
          </div>
        </div>

        <div className="cred-block">
          <div className="h">
            THE VOICE · TTS {chip(view?.tts.apiKeySet ?? false)}
          </div>
          <div className="cred-row">
            <div className="cred-pair">
              <label className="cred-field">
                <span className="l">PROVIDER</span>
                <input value={draft.ttsProvider} onChange={(event) => setField('ttsProvider')(event.target.value)} placeholder="piper" spellCheck={false} />
              </label>
              <label className="cred-field">
                <span className="l">VOICE</span>
                <input value={draft.ttsVoice} onChange={(event) => setField('ttsVoice')(event.target.value)} placeholder="en_US-amy-medium" spellCheck={false} />
              </label>
            </div>
            <label className="cred-field">
              <span className="l">BASE URL (fish family only)</span>
              <input
                value={draft.ttsBaseUrl}
                onChange={(event) => setField('ttsBaseUrl')(event.target.value)}
                placeholder="http://127.0.0.1:8080"
                spellCheck={false}
              />
            </label>
            <label className="cred-field">
              <span className="l">API KEY</span>
              <input
                type="password"
                value={draft.ttsKey}
                onChange={(event) => setField('ttsKey')(event.target.value)}
                placeholder={keyHint(view?.tts.apiKeySet ?? false)}
                autoComplete="off"
              />
            </label>
          </div>
        </div>

        <div className="cred-block">
          <div className="h">
            THE MUSIC · NETEASE {chip(view?.music.cookieSet ?? false)}
          </div>
          <div className="cred-row">
            <label className="cred-field">
              <span className="l">PROVIDER</span>
              <input value={draft.musicProvider} onChange={(event) => setField('musicProvider')(event.target.value)} placeholder="netease" spellCheck={false} />
            </label>
            <label className="cred-field">
              <span className="l">COOKIE HEADER</span>
              <textarea
                value={draft.cookie}
                onChange={(event) => setField('cookie')(event.target.value)}
                placeholder={(view?.music.cookieSet ?? false) ? 'stored — paste to replace' : 'paste the whole cookie header'}
                spellCheck={false}
              />
            </label>
          </div>
        </div>

        <div className="cred-foot">
          <span className={note.kind === 'err' ? 'cred-msg err' : note.kind === 'ok' ? 'cred-msg ok' : 'cred-msg'}>{note.text}</span>
          <button className="cred-btn" type="button" onClick={onClose}>
            CANCEL
          </button>
          <button className="cred-btn primary" type="button" onClick={save}>
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}