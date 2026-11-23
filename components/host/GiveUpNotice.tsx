'use client';

import { useEffect, useRef } from 'react';

import { Switch } from '@/components/ds';
import { send } from '@/lib/client/api';
import { updateSettings, useSettings } from '@/lib/client/settings';
import type { RoomView } from '@/lib/game/types';

/**
 * Where give-ups are announced is a setting of this screen, kept in this
 * browser, but the phones decide whether to show a banner. So this copies it
 * into the room whenever the two differ. Unlike the setlist it may change
 * mid-game: it only decides who sees a banner.
 */
export function useGiveUpNoticeSync(view: RoomView | null, token: string | null): void {
  const { giveUpNotice: wanted } = useSettings();
  const inRoom = view?.giveUpNotice ?? null;
  const code = view?.code;

  const sent = useRef<string | null>(null);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!code || !token || inRoom === null) return;
    // The room moved: whatever was in flight has landed, or lost a race.
    if (inRoom !== seen.current) {
      seen.current = inRoom;
      sent.current = null;
    }
    if (inRoom === wanted || sent.current === wanted) return;
    sent.current = wanted;
    void send(code, token, { type: 'give-up-notice', notice: wanted }).then((result) => {
      if (!result.ok && sent.current === wanted) sent.current = null;
    });
  }, [code, token, inRoom, wanted]);
}

/**
 * For the settings menu: whether the other phones hear about a give-up, or
 * only the TV. A switch, not a pair of options, to keep the menu short
 * enough for the screen.
 */
export function GiveUpNoticeSetting() {
  const { giveUpNotice } = useSettings();
  return (
    <Switch
      label="Give-ups on every phone"
      hint="Phones show who gave up, too. Off: only this screen does."
      checked={giveUpNotice === 'everyone'}
      onChange={(on) => updateSettings({ giveUpNotice: on ? 'everyone' : 'host' })}
    />
  );
}
