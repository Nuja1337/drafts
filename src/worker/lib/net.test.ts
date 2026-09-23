import { describe, expect, it } from "vitest";
import { networkKey } from "./net";

describe("networkKey", () => {
  it("keeps IPv4 addresses", () => {
    expect(networkKey("203.0.113.7")).toBe("203.0.113.7");
    expect(networkKey(" 10.0.0.1 ")).toBe("10.0.0.1");
  });

  it("groups IPv6 addresses by /64", () => {
    expect(networkKey("2001:db8:1:2:aa::1")).toBe("2001:db8:1:2::/64");
    expect(networkKey("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(networkKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(networkKey("::1")).toBe("0:0:0:0::/64");
    expect(networkKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(networkKey("64:ff9b::192.0.2.33")).toBe("64:ff9b:0:0::/64");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(networkKey("::ffff:198.51.100.4")).toBe("198.51.100.4");
  });

  it("falls back for missing or unparseable input", () => {
    expect(networkKey(null)).toBe("unknown");
    expect(networkKey("")).toBe("unknown");
    expect(networkKey("1::2::3")).toBe("1::2::3");
  });
});
