/**
 * 首次体验的两条**内容**：随包的那一首，和它那段**冻结**的口播。
 *
 * 为什么文案写在代码里、音频却是文件：文案是给界面看的那一句，音频是给耳朵听的那一份，
 * 两者必须**同源**（一起改，不能漂）。所以文案在这里，音频由 `tools/make-demo-voice.mjs`
 * 拿同一个常量合成到 `assets/demo/`，随包发 —— 改文案就得重跑那个脚本，改不动就一起改不动。
 */

/** 文件名的形状是本地源认歌的规矩（`Artist - Title.mp3`，core/music/local.ts）。 */
export const DEMO_SONG_FILE = 'Harry Styles - Sign of the Times.mp3';

/** 那段口播的音频文件。由 `tools/make-demo-voice.mjs` 用上面这句文案合成，随包发。 */
export const DEMO_WAV_FILE = 'sign-of-the-times.wav';

export const DEMO_LINE =
  'Sign of the Times — Harry Styles. A slow piano ballad with a chorus that keeps climbing. ' +
  'Nothing in it is in a hurry, and neither are we.';