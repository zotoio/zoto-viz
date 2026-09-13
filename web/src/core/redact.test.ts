import { describe, expect, it } from "vitest";
import { rCidr, rIp, rMac, rName, rText, redaction } from "./redact";

describe("redact", () => {
  it("passes through when off", () => {
    redaction.enabled = false;
    expect(rIp("192.168.86.10")).toBe("192.168.86.10");
    expect(rMac("aa:bb:cc:dd:ee:ff")).toMatch(/aa:bb/i);
    expect(rName("nest")).toBe("nest");
    expect(rText("hello 10.0.0.1")).toContain("10.0.0.1");
    expect(rCidr("10.0.0.0/8")).toBe("10.0.0.0/8");
  });

  it("masks addresses and names when on", () => {
    redaction.enabled = true;
    expect(rIp("192.168.86.10")).toBe("192.168.xx.10");
    expect(rIp("10.1.2.3")).toMatch(/xx/);
    expect(rIp("8.8.8.8")).toBe("8.8.xx.xx");
    expect(rIp("fd00:1111:2222::1")).toMatch(/…/);
    expect(rMac("aa:bb:cc:dd:ee:ff")).toBe("aa:bb:cc:xx:xx:xx");
    expect(rName("secret-host.local")).not.toBe("secret-host.local");
    expect(rName("api.example.com")).toMatch(/example\.com/);
    expect(rName("1.2.3.4.in-addr.arpa")).toMatch(/arpa/);
    expect(rCidr("192.168.86.0/24")).toMatch(/\//);
    expect(rText("talk to 192.168.86.10 on aa:bb:cc:dd:ee:ff")).not.toContain("192.168.86.10");
    expect(rText("host.local and fd00::1")).toBeTruthy();
    redaction.enabled = false;
  });
});
