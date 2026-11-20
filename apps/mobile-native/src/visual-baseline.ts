// The mini-program uses a 750rpx design grid. Keep the same proportions in the
// phone viewport, and cap the scale on tablets to keep text and controls usable.
export const rpxScale = (width: number) => Math.min(width, 450) / 750

// Page gutters come from the route's own index.wxss, not a global screen inset.
export const routeGutters = {
  entry: [48, 80, 120],
  login: [40, 64, 64],
  home: [32, 0, 32],
  projects: [32, 18, 32],
  'all-sessions': [32, 18, 32],
  'project-sessions': [32, 16, 32],
  'bridge-devices': [20, 0, 48],
  chat: [32, 0, 0],
  'session-tasks': [32, 0, 160],
  profile: [24, 24, 48],
  sync: [24, 24, 48],
  devices: [24, 24, 48],
  password: [24, 24, 48],
  demo: [24, 24, 60],
} as const
