/**
 * Short sounds the app plays itself — the pop when a reaction is tapped, and the
 * water drop when a notification reaches the open app.
 *
 * ## One player per sound, kept alive, rather than one per play
 *
 * `createAudioPlayer` allocates a native player and decodes the file. Doing that
 * inside the tap handler puts a decode between the finger and the sound, which
 * on a mid-range Android is long enough to arrive after the animation it is
 * meant to accompany — and it leaks, because a player is only freed by
 * `remove()`. So each player is built once, lazily, and every later play
 * rewinds and replays the same one.
 *
 * Lazily, not at import: this module is pulled in by the community feed, and
 * building a native audio player as a side effect of a screen being *bundled*
 * would run on app start for everybody, including the accounts that never open
 * that tab.
 *
 * ## Rewind before play, or the second one is silent
 *
 * A player that has reached the end of a 300ms clip is not "stopped", it is
 * parked at the end — `play()` on it produces nothing. Every call therefore
 * seeks to zero first. The seek is a promise the tap does not wait on: awaiting
 * it would move the sound a frame later for no gain, since the following
 * `play()` is queued on the same native player in order.
 *
 * ## A silent phone stays silent
 *
 * `playsInSilentMode: false` is the whole reason the audio mode is set at all.
 * This is decoration on a feed people scroll in lectures and on buses; a pop
 * that ignores the ringer switch is the kind of thing an app gets deleted over.
 * `mixWithOthers` is the matching choice on the other axis — a 300ms UI blip
 * must never pause somebody's music, which is what requesting audio focus does.
 *
 * ## The notification drop takes the notification path on Android
 *
 * Backgrounded, a push sounds through its channel and this module is not
 * involved. Open, the socket usually beats the push, so the app has to make the
 * sound itself — `lib/notification-sound.ts` decides whether.
 *
 * `playsInSilentMode` is the iOS ringer switch; Android has no equivalent for
 * media, and expo-audio only plays media, so there the drop would sound with the
 * phone on silent. On Android it is therefore played by `HostelHubSound`
 * (`modules/hostelhub-sound`) on the notification stream, which obeys the ringer
 * mode and Do Not Disturb exactly as a real notification does. A binary without
 * that module — only a dev client older than it — falls back to expo-audio
 * rather than to silence.
 *
 * ## It can fail, and nothing may notice
 *
 * A device with no audio route, a codec the OS declines, a player the system
 * reclaimed under memory pressure — every one of them throws from inside a tap
 * handler that is otherwise about to post a reaction to the server. None is
 * worth a toast, let alone an unhandled rejection, so the whole path swallows.
 */

import {
  type AudioPlayer,
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

/**
 * `require`, not an import: Metro resolves an asset to a module id that
 * `createAudioPlayer` takes directly, and there is no static-import spelling of
 * that for a non-code file.
 */
const REACTION_POP = require("../../assets/sounds/reaction-pop.mp3") as number;

/**
 * The MP3, not the WAV `app.json` hands the OS: this is the Metro asset copy for
 * expo-audio, which is what iOS and the fallback play in-app.
 */
const NOTIFICATION_DROP = require("../../assets/notifications/water_drop.mp3") as number;

type NativeSound = { playNotificationTone(): Promise<boolean> };

/** Android only. Null on iOS, and on a binary built before the module existed. */
const nativeSound =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeSound>("HostelHubSound")
    : null;

const players = new Map<number, AudioPlayer>();
/** Set once the first player is built, so the mode is configured a single time. */
let modeConfigured = false;

function ensurePlayer(source: number): AudioPlayer | null {
  const existing = players.get(source);

  if (existing) {
    return existing;
  }

  let player: AudioPlayer;

  try {
    player = createAudioPlayer(source);
  } catch {
    return null;
  }

  players.set(source, player);

  if (!modeConfigured) {
    modeConfigured = true;

    void setAudioModeAsync({
      interruptionMode: "mixWithOthers",
      playsInSilentMode: false,
    }).catch(() => {
      // The sound still plays; it just may not respect the ringer switch.
    });
  }

  return player;
}

function play(source: number): void {
  const active = ensurePlayer(source);

  if (!active) {
    return;
  }

  try {
    void active.seekTo(0).catch(() => {
      // A seek that loses its player is not a reason to skip the play() below.
    });
    active.play();
  } catch {
    // See the header: a sound effect never surfaces its own failure.
  }
}

/** The pop a reaction makes. Safe to call as fast as a finger can tap. */
export function playReactionPop(): void {
  play(REACTION_POP);
}

/**
 * The app's notification tone, for a notification that reached the open app.
 * Callers decide *whether* through `claimNotificationSound`; this only plays.
 */
export function playNotificationDrop(): void {
  if (nativeSound) {
    // `false` back means silent or vibrate — the phone's answer, deliberately
    // not a reason to fall back to the media stream and play it anyway.
    void nativeSound.playNotificationTone().catch(() => undefined);
    return;
  }

  play(NOTIFICATION_DROP);
}

/**
 * Free the native players.
 *
 * Nothing calls this today — both clips are small and the screens that play
 * them are ones people come back to, so holding them decoded is cheaper than
 * rebuilding them. It exists so that a future screen with a sound of its own has
 * an obvious place to release one, rather than discovering there is no way to.
 */
export function releaseSoundEffects(): void {
  for (const player of players.values()) {
    try {
      player.remove();
    } catch {
      // Already gone, which is the state we wanted.
    }
  }

  players.clear();
}
