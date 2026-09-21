import type { PluginView } from "./plugin";

const STORE = "zoto-viz.autoconsent";

export function autoconsentEnabled(): boolean {
  return localStorage.getItem(STORE) === "1";
}

export function setAutoconsent(on: boolean): void {
  localStorage.setItem(STORE, on ? "1" : "0");
}

/** Shipped src trees and operator-installed local zips — not contrib catalog zips. */
export function autoconsentEligible(spec: PluginView): boolean {
  return spec.origin === "src" || spec.origin === "local";
}

export function autoconsentKind(spec: PluginView): "authored" | "reviewed" {
  return spec.origin === "src" ? "authored" : "reviewed";
}
