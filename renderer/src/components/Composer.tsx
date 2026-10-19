import { useState } from 'react';

/** 底部输入。麦克风只有外观 —— v1 没有语音识别这条链路（需求·假设 7）。 */
export function Composer({ onSay, busy }: { onSay: (text: string) => void; busy: boolean }) {
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
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Say something to the DJ..."
          aria-label="Say something to the DJ"
        />
        <button className="text-btn" type="button" title="Voice input is not wired up in v1" aria-disabled="true">
          🎤
        </button>
      </div>
      <button className="send" type="submit" disabled={busy || !text.trim()}>
        SEND
      </button>
    </form>
  );
}