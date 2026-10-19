import type { ReactNode } from 'react';

export type IconName = 'prev' | 'next' | 'play' | 'pause' | 'stop' | 'heart' | 'up' | 'mic' | 'headphone' | 'close';

/* 界面里没有实心图标库，也没有 emoji：字形一律走这套 12×12 的线性/实心形状。
   （unicode 的 ⏮ ⏸ ⏭ 在 Windows 上会掉进 emoji 字体，渲染成彩色的 —— 那是另一套语言。） */
const SHAPES: Record<IconName, ReactNode> = {
  prev: (
    <>
      <rect x="2" y="2.5" width="1.4" height="7" fill="currentColor" />
      <path d="M10 2.5 4.6 6 10 9.5Z" fill="currentColor" />
    </>
  ),
  next: (
    <>
      <rect x="8.6" y="2.5" width="1.4" height="7" fill="currentColor" />
      <path d="M2 2.5 7.4 6 2 9.5Z" fill="currentColor" />
    </>
  ),
  play: <path d="M3.6 2.3 9.4 6 3.6 9.7Z" fill="currentColor" />,
  pause: (
    <>
      <rect x="3.2" y="2.5" width="2" height="7" fill="currentColor" />
      <rect x="6.8" y="2.5" width="2" height="7" fill="currentColor" />
    </>
  ),
  stop: <rect x="3.2" y="3.2" width="5.6" height="5.6" fill="currentColor" />,
  heart: (
    <path
      d="M6 9.5C6 9.5 1.9 7.1 1.9 4.6a2.2 2.2 0 0 1 4.1-1 2.2 2.2 0 0 1 4.1 1c0 2.5-4.1 4.9-4.1 4.9Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    />
  ),
  up: (
    <path
      d="M6 10.2V2.4M2.9 5.5 6 2.3l3.1 3.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  mic: (
    <>
      <rect x="4.4" y="1.6" width="3.2" height="6" rx="1.6" fill="currentColor" />
      <path d="M2.9 6.1a3.1 3.1 0 0 0 6.2 0M6 9.2v1.3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  close: (
    <path d="M3.1 3.1 8.9 8.9M8.9 3.1 3.1 8.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  ),
  headphone: (
    <>
      <path d="M2.2 7.6V5.9a3.8 3.8 0 0 1 7.6 0v1.7" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <rect x="1.3" y="7" width="2.5" height="3.3" rx="0.9" fill="currentColor" />
      <rect x="8.2" y="7" width="2.5" height="3.3" rx="0.9" fill="currentColor" />
    </>
  ),
};

export function Icon({ name, size = 12 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false" fill="none">
      {SHAPES[name]}
    </svg>
  );
}