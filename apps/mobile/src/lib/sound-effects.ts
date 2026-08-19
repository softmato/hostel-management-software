/**
 * Short UI sounds — currently the one that fires when a reaction is tapped.
 *
 * ## One player, kept alive, rather than one per tap
 *
 * `createAudioPlayer` allocates a native player and decodes the file. Doing that
 * inside the tap handler puts a decode between the finger and the sound, which
 * on a mid-range Android is long enough to arrive after the animation it is
 * meant to accompany — and it leaks, because a player is only freed by
 * `remove()`. So the player is built once, lazily, and every later tap rewinds
 * and replays the same one.
 *
 * Lazily, not at import: this module is pulled in by the community feed, and
 * building a native audio player as a side effect of a screen being *bundled*
 * would run on app start for everybody, including the accounts that never open
 * that tab.
 *
 * ## Rewind before play, or the second tap is silent
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

/**
 * `require`, not an import: Metro resolves an asset to a module id that
 * `createAudioPlayer` takes directly, and there is no static-import spelling of
 * that for a non-code file.
 */
const REACTION_POP = require("../../assets/sounds/reaction-pop.mp3") as number;

let player: AudioPlayer | null = null;
/** Set once the first player is built, so the mode is configured a single time. */
let modeConfigured = false;

function ensurePlayer(): AudioPlayer | null {
  if (player) {
    return player;
  }

  try {
    player = createAudioPlayer(REACTION_POP);
  } catch {
    return null;
  }

  if (!modeConfigured) {
    modeConfigured = true;

    void setAudioModeAsync({
      interruptionMode: "mixWithOthers",
      playsInSilentMode: false,
    }).catch(() => {
      // The pop still plays; it just may not respect the ringer switch.
    });
  }

  return player;
}

/** The pop a reaction makes. Safe to call as fast as a finger can tap. */
export function playReactionPop(): void {
  const active = ensurePlayer();

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

/**
 * Free the native player.
 *
 * Nothing calls this today — the feed is a tab people come back to, and holding
 * one decoded 33KB clip is cheaper than rebuilding it on every visit. It exists
 * so that a future screen with a different sound has an obvious place to release
 * one, rather than discovering that this module has no way to.
 */
export function releaseSoundEffects(): void {
  try {
    player?.remove();
  } catch {
    // Already gone, which is the state we wanted.
  }

  player = null;
}
