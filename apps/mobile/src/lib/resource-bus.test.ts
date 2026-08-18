import { afterEach, describe, expect, it, vi } from "vitest";

import {
  publishTopics,
  resetResourceBus,
  subscribeAllTopics,
  subscribeTopics,
} from "@/lib/resource-bus";

afterEach(() => resetResourceBus());

describe("resource bus", () => {
  it("notifies a screen watching one of the published topics", () => {
    const listener = vi.fn();
    subscribeTopics(["payments"], listener);

    publishTopics(["payments"]);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("leaves unrelated screens alone", () => {
    const payments = vi.fn();
    const food = vi.fn();
    subscribeTopics(["payments"], payments);
    subscribeTopics(["food"], food);

    publishTopics(["food"]);

    expect(payments).not.toHaveBeenCalled();
    expect(food).toHaveBeenCalledTimes(1);
  });

  it("fires once for a screen watching several topics in one publish", () => {
    const listener = vi.fn();
    subscribeTopics(["payments", "notifications"], listener);

    publishTopics(["payments", "notifications"]);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTopics(["notices"], listener);

    unsubscribe();
    publishTopics(["notices"]);

    expect(listener).not.toHaveBeenCalled();
  });

  /*
   * The topic list arrives over a socket, so it is untrusted. A build that has
   * never heard of a topic must no-op rather than pass the string on.
   */
  it("drops topics this build does not know", () => {
    const listener = vi.fn();
    subscribeAllTopics(listener);

    expect(publishTopics(["payments", "quantum-ledgers"])).toEqual(["payments"]);
    expect(listener).toHaveBeenCalledWith(["payments"]);
  });

  it("does nothing at all when every topic is unknown", () => {
    const listener = vi.fn();
    subscribeAllTopics(listener);

    expect(publishTopics(["nope"])).toEqual([]);
    expect(publishTopics([])).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("survives non-string junk in the payload", () => {
    const listener = vi.fn();
    subscribeAllTopics(listener);

    expect(publishTopics([null, 7, {}, undefined])).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  /*
   * These are unrelated screens. One broken loader must not stop the others
   * refreshing, or a small bug becomes a dead app.
   */
  it("keeps notifying after a listener throws", () => {
    const broken = vi.fn(() => {
      throw new Error("loader blew up");
    });
    const healthy = vi.fn();

    subscribeTopics(["payments"], broken);
    subscribeTopics(["payments"], healthy);

    expect(() => publishTopics(["payments"])).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("lets a listener unsubscribe itself mid-notify", () => {
    const second = vi.fn();
    const unsubscribeFirst = subscribeAllTopics(() => unsubscribeFirst());
    subscribeAllTopics(second);

    expect(() => publishTopics(["food"])).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ignores a subscription with no topics rather than firing on everything", () => {
    const listener = vi.fn();
    subscribeTopics([], listener);

    publishTopics(["payments", "food", "notices"]);

    expect(listener).not.toHaveBeenCalled();
  });
});
