'use client';

import { useEffect, useRef } from 'react';

import { Switch } from '@/components/ds';
import { send } from '@/lib/client/api';
import { updateSettings, useSettings } from '@/lib/client/settings';
import { RIDE_SHARE } from '@/lib/game/config';
import type { RoomView } from '@/lib/game/types';

/**
 * House rules are settings of this screen, like the setlist mode, but the
 * reducer is what enforces them. So between games this copies them into the
 * room whenever the two differ.
 */
export function useHouseRulesSync(view: RoomView | null, token: string | null): void {
  const { rideAlong } = useSettings();
  const between = view?.phase === 'lobby' || view?.phase === 'finished';
  const inRoom = view?.rideAlong;
  const code = view?.code;

  const sent = useRef<boolean | null>(null);
  useEffect(() => {
    if (!code || !token || !between || inRoom === undefined) return;
    if (inRoom === rideAlong) {
      sent.current = null;
      return;
    }
    if (sent.current === rideAlong) return;
    sent.current = rideAlong;
    void send(code, token, { type: 'rules', rideAlong }).then((result) => {
      if (!result.ok && sent.current === rideAlong) sent.current = null;
    });
  }, [code, token, between, inRoom, rideAlong]);
}

/** For the settings menu. */
export function HouseRulesSetting() {
  const { rideAlong } = useSettings();
  return (
    <Switch
      label="Ride along"
      hint={`Giving up can back a player still in, for ${RIDE_SHARE * 100}% of what they score. Applies from the next game.`}
      checked={rideAlong}
      onChange={(next) => updateSettings({ rideAlong: next })}
    />
  );
}
