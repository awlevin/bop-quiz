// Where a give-up is announced. The TV always drops its white flag; with
// 'everyone' the other phones also get a small "Ana gave up" banner, with
// 'host' they show nothing. A host setting, copied into the room because the
// phones need to know it.

export const GIVE_UP_NOTICES = ['everyone', 'host'] as const;

export type GiveUpNotice = (typeof GIVE_UP_NOTICES)[number];

/** Also what a room from before this setting reads as. */
export const DEFAULT_GIVE_UP_NOTICE: GiveUpNotice = 'everyone';

export function isGiveUpNotice(raw: unknown): raw is GiveUpNotice {
  return GIVE_UP_NOTICES.includes(raw as GiveUpNotice);
}
