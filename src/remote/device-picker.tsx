import { Check, Laptop, MonitorSpeaker, Smartphone } from 'lucide-react';
import { useEffect, type MouseEvent } from 'react';
import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { useOnline } from '@/connectivity/connection';
import type { SessionInfo } from '@/jellyfin/api';
import { deviceName, guessedDeviceName } from '@/jellyfin/identity';
import { usePlayer } from '@/player/player';
import { Sheet, type Anchor } from '@/ui/sheet';
import { isDesktop } from '@/ui/use-desktop';
import { playHere, playOn, refreshDevices, useDevices } from './remote';
import styles from './device-picker.module.css';

const usePicker = create<{ open: boolean; anchor: Anchor | null }>(() => ({ open: false, anchor: null }));

const close = () => usePicker.setState({ open: false });

/** The device button: opens "Play on" (as a menu beside the button on a computer). */
export function DeviceButton({ className, size = 20 }: { className: string; size?: number }) {
  const remote = usePlayer((s) => s.remote);
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    usePicker.setState({ open: true, anchor: isDesktop() ? { x: rect.right, y: rect.bottom, top: rect.top } : null });
  };
  return (
    <button
      type="button"
      className={className}
      data-active={remote ? true : undefined}
      onClick={onClick}
      aria-label={remote ? `Playing on ${remote.deviceName}. Choose where to play` : 'Choose where to play'}
      title="Play on"
    >
      <MonitorSpeaker size={size} strokeWidth={2} />
    </button>
  );
}

function iconFor(name: string) {
  return /iPhone|Android|phone/i.test(name) ? Smartphone : Laptop;
}

function describe(session: SessionInfo) {
  const item = session.NowPlayingItem;
  if (!item) return 'Open, not playing';
  return `${session.PlayState?.IsPaused ? 'Paused' : 'Playing'} · ${item.Name}`;
}

/** "Play on": this device and JellyJet open on the account's other devices. */
export function DevicePickerHost() {
  const { open, anchor } = usePicker();
  const devices = useDevices((s) => s.devices);
  const loaded = useDevices((s) => s.loaded);
  const remote = usePlayer((s) => s.remote);
  const playingHere = usePlayer((s) => s.playing && !s.remote);
  const userName = useSession((s) => s.session?.userName);
  const online = useOnline();

  // The list is kept current all along; opening it also asks the server right away.
  useEffect(() => {
    if (open) void refreshDevices();
  }, [open]);

  const here = deviceName();
  const HereIcon = iconFor(guessedDeviceName());

  return (
    <Sheet open={open} onClose={close} title="Play on" anchor={anchor}>
      <div className={styles.list}>
        <button
          type="button"
          className={styles.row}
          data-current={!remote || undefined}
          onClick={() => {
            close();
            if (remote) playHere();
          }}
        >
          <span className={styles.icon}>
            <HereIcon size={20} strokeWidth={2} />
          </span>
          <span className={styles.text}>
            <span className={styles.name}>This device</span>
            <span className={styles.detail}>{playingHere ? `Playing · ${here}` : here}</span>
          </span>
          {!remote && <Check size={20} strokeWidth={2.6} className={styles.check} />}
        </button>

        {devices.map((session) => {
          const Icon = iconFor(session.DeviceName);
          const current = remote?.deviceId === session.DeviceId;
          return (
            <button
              key={session.Id}
              type="button"
              className={styles.row}
              data-current={current || undefined}
              onClick={() => {
                close();
                if (!current) void playOn(session);
              }}
            >
              <span className={styles.icon}>
                <Icon size={20} strokeWidth={2} />
              </span>
              <span className={styles.text}>
                <span className={styles.name}>{session.DeviceName}</span>
                <span className={styles.detail}>{describe(session)}</span>
              </span>
              {current && <Check size={20} strokeWidth={2.6} className={styles.check} />}
            </button>
          );
        })}

        {!online ? (
          <p className={styles.note}>Playing on another device needs a connection.</p>
        ) : (
          loaded &&
          devices.length === 0 && (
            <p className={styles.note}>
              Open JellyJet on another device, signed in as {userName ?? 'you'}, and it shows up here. An iPhone needs the app
              open or playing.
            </p>
          )
        )}
      </div>
    </Sheet>
  );
}
