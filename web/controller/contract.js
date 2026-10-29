export const actions = [
  ['reload', '换弹', 'reload'], ['next_weapon', '切换武器', 'weapon'], ['grenade', '手雷', 'grenade'],
  ['shield', '护盾', 'shield'], ['jump', '跳跃', 'jump'], ['heal', '治疗', 'heal'],
  ['roll', '翻滚', 'roll'], ['interact', '交互拾取', 'interact'], ['toggle_crouch', '蹲伏', 'crouch'],
];
const paths = {
  reload: '<path d="M10 3h4l2 7v11H8V10z"/><path d="M8 11h8M8 17h8"/>',
  weapon: '<path d="M3 9h12v6H6l-3-2zM15 11h6M9 15l-2 6M12 15l3 5M4 7h5"/>',
  grenade: '<path d="m14 4 3 2-1 4M13 3l5 2"/><ellipse cx="11" cy="15" rx="7" ry="8"/><path d="m5 12 12 5"/>',
  shield: '<path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6zM12 3v18"/>',
  jump: '<circle cx="15" cy="4" r="2"/><path d="m9 8 5-1 3 4 4-1M14 7l-3 7 5 2-2 6M11 14l-5 6M9 8l-4 3"/>',
  heal: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  roll: '<path d="M4 9a9 9 0 1 1-1 6M4 9V3M4 9h6"/><circle cx="14" cy="10" r="2"/><path d="m11 13-4 5m4-5 5 2-3 4"/>',
  interact: '<path d="m12 2 10 5v11l-10 5L2 18V7zM2 7l10 5 10-5M12 12v11"/>',
  crouch: '<circle cx="14" cy="4" r="2"/><path d="m13 8-4 5 7 3 4 6M9 13l-4 4 8 1-2 4M13 8l3 4 5 1"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
export const freshControls = () => ({move: {x: 0, y: 0}, look: {yaw: 0, pitch: 0}, buttons: {fire: false, aim: false}});
