// @games/web — 모든 게임이 함께 쓰는 브라우저 코드 (게임 엔진과 무관한 DOM·네트워크 도우미).
// 게임 화면(Phaser·Pixi 등)과 게임별 로비 화면은 각 게임 앱에 둔다.
export { ChatBox, ChatLog } from './chat';
export type { ChatRoom, FloatingPlace } from './chat';
export { GameStorage, serverUrl } from './storage';
