import { useState } from 'react';
import type { RefObject } from 'react';
import { Icon } from './Icon.tsx';

/** ⑦ 输入条。麦克风只有外观 —— v1 没有语音识别这条链路（交互决策 4）。 */
export function Composer({
  onSay,
  busy,
  inputRef,
}: {
  onSay: (text: string) => void;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim() || busy) return;
    onSay(text);
    setText('');
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="field">
        <input
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Say something to the DJ..."
          aria-label="Say something to the DJ"
        />
        <span className="ghost" title="Voice input is not wired up in v1">
          <Icon name="mic" size={14} />
        </span>
      </div>
      <button className="send" type="submit" disabled={busy || !text.trim()} aria-label="Send">
        <Icon name="up" size={14} />
      </button>
    </form>
  );
}