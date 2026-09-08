/**
 * The app's entry point, which exists for exactly one reason.
 *
 * `main` used to be `expo-router/entry` directly, and for everything the app
 * does while somebody is looking at it that was right. The night-status
 * notification is the exception: its buttons are answered on a phone whose app
 * is not running, so the code that records the answer has to be loaded by the
 * time the OS wakes the process — before any screen, any router, any React.
 *
 * `expo-task-manager` requires the task to be defined in the module scope of a
 * module required early, and "early" here means *before the router*, because a
 * headless wake never mounts a screen at all. So this file imports the task
 * first and hands over to the router second, and the order of these two lines
 * is the whole content of the file.
 *
 * See `src/lib/night-status-task.ts` for what the task does and why iOS takes a
 * different path through it.
 */

import "./src/lib/night-status-task";

import "expo-router/entry";
