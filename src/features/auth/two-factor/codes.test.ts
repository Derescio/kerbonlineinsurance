import { describe, expect, it } from "vite-plus/test";

import {
  backupCodesFile,
  formatSetupKey,
  isBackupCode,
  isTotp,
  normaliseBackupCode,
  normaliseTotp,
  setupKeyFrom,
} from "./codes";

// How the two-factor screens read what people type (Review Focus 3)

describe("normaliseTotp", () => {
  it("drops spaces", () => {
    expect(normaliseTotp(" 123 456 ")).toBe("123456");
  });

  it("drops anything that isn't a digit, such as a pasted dash", () => {
    expect(normaliseTotp("123-456")).toBe("123456");
  });

  it("isTotp takes exactly six digits", () => {
    expect(isTotp("123456")).toBe(true);
    expect(isTotp("12345")).toBe(false);
    expect(isTotp("1234567")).toBe(false);
  });
});

describe("normaliseBackupCode", () => {
  it("upper-cases", () => {
    expect(normaliseBackupCode("abcde-12345")).toBe("ABCDE-12345");
  });

  it("puts the dash back", () => {
    expect(normaliseBackupCode("abcde12345")).toBe("ABCDE-12345");
  });

  it("drops spaces", () => {
    expect(normaliseBackupCode(" abcde 12345 ")).toBe("ABCDE-12345");
  });

  it("isBackupCode takes XXXXX-XXXXX only", () => {
    expect(isBackupCode("ABCDE-12345")).toBe(true);
    expect(isBackupCode("ABCDE-1234")).toBe(false);
    expect(isBackupCode("ABCDE_12345")).toBe(false);
  });
});

describe("the setup key", () => {
  const uri = "otpauth://totp/Kerb:maya%40example.com?secret=JBSWY3DPEHPK3PXPK4ZQ&issuer=Kerb";

  it("comes from the otpauth URI", () => {
    expect(setupKeyFrom(uri)).toBe("JBSWY3DPEHPK3PXPK4ZQ");
  });

  it("is shown in groups of four", () => {
    expect(formatSetupKey("JBSWY3DPEHPK3PXPK4ZQ")).toBe("JBSW Y3DP EHPK 3PXP K4ZQ");
  });

  it("is empty for a URI without one", () => {
    expect(setupKeyFrom("not a uri")).toBe("");
  });
});

describe("backupCodesFile", () => {
  it("lists one code per line", () => {
    expect(backupCodesFile(["AAAAA-11111", "BBBBB-22222"])).toContain("AAAAA-11111\nBBBBB-22222\n");
  });
});
