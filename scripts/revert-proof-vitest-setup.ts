/**
 * Injected by revert-proof overlay config. Brands errors from real expect() / expect.soft()
 * matchers (chai Assertion prototype), not from test-authored meta or plain throws.
 */
import { chai } from "vitest";
import { installRevertProofChaiBranding } from "./revert-proof-vitest-brand.mjs";

installRevertProofChaiBranding(chai);
