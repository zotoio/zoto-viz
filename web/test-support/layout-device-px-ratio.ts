/**
 * Test harness for layout DPR module state (not imported from production entry points).
 */
export {
  configureLayoutMaxDevicePxRatio,
  DEFAULT_MAX_DEVICE_PX_RATIO,
  devicePxRatioFromNumber,
  devicePxRatioFromWindow,
  devicePxRatioNumber,
  layoutBackingDevicePx,
  layoutDevicePxRatio,
  onLayoutDevicePxRatioChange,
  pinLayoutDevicePxRatio,
  resetLayoutDevicePxRatioWatch,
  startLayoutDevicePxRatioWatch,
} from "../src/graph/render-host-device-px-ratio";
